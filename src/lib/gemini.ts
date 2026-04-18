import { GoogleGenAI, Type } from "@google/genai";
import { findBestMatch } from "./utils";

export type EntryType = 'sales' | 'ev_sessions' | 'expenses';

export interface BaseEntry {
  payment_mode: string;
  uncertain?: boolean;
  reasoning?: string;
}

export interface SaleEntry extends BaseEntry {
  item_name: string;
  quantity: number;
  rate: number;
  total: number;
}

export interface EVSessionEntry extends BaseEntry {
  total_amount: number;
  category: string;
  start_percent: number;
  end_percent: number;
  kcal?: number;
  per_unit_rate: number;
  per_percent_rate: number;
}

export interface ExpenseEntry extends BaseEntry {
  description: string;
  amount: number;
  category: string;
  remarks: string;
}

export interface ExtractionResult {
  entry_type: EntryType;
  date: string;
  entries: (SaleEntry | EVSessionEntry | ExpenseEntry)[];
  total_amount: number;
  summary_reasoning: string;
  raw_text?: string;
  pages?: ExtractionResult[]; // For multi-day PDFs
}

export interface RefinedSaleEntry extends SaleEntry {
  corrected_from?: string;
  matched_from?: string;
}

export async function refineSalesData(
  entries: any[], 
  productRates: { item_name: string, rate: number }[],
  corrections: { wrong_text: string, correct_text: string }[]
): Promise<RefinedSaleEntry[]> {
  // We make it async to keep the interface consistent, but it's now pure code logic
  return entries.map(entry => {
    let currentName = entry.item_name || '';
    let correctedFrom: string | undefined;
    let matchedFrom: string | undefined;
    let rate: number | null = null;
    let totalAmount: number | null = null;
    let uncertain = false;

    // STEP 1: APPLY SELF-LEARNING (Corrections)
    // Find best match in corrections_list
    const correctionMatch = findBestMatch(currentName, corrections.map(c => c.wrong_text), 0.2);
    if (correctionMatch) {
      const correction = corrections.find(c => c.wrong_text.toLowerCase() === correctionMatch.toLowerCase());
      if (correction && correction.correct_text.toLowerCase() !== currentName.toLowerCase()) {
        correctedFrom = currentName;
        currentName = correction.correct_text;
      }
    }

    // STEP 2: MATCH WITH PRODUCT RATES
    const rateMatchName = findBestMatch(currentName, productRates.map(p => p.item_name), 0.3);
    if (rateMatchName) {
      const product = productRates.find(p => p.item_name.toLowerCase() === rateMatchName.toLowerCase());
      if (product) {
        rate = product.rate;
        if (rateMatchName.toLowerCase() !== currentName.toLowerCase()) {
          matchedFrom = currentName;
        }
        currentName = product.item_name; // Use the canonical name from DB
      }
    } else {
      uncertain = true;
    }

    // STEP 3: CALCULATE TOTAL
    if (rate !== null && entry.quantity) {
      totalAmount = entry.quantity * rate;
    }

    return {
      ...entry,
      item_name: currentName,
      rate: rate || entry.rate || null,
      total_amount: totalAmount || entry.total_amount || null,
      corrected_from: correctedFrom,
      matched_from: matchedFrom,
      uncertain: uncertain
    };
  });
}

const getApiKey = () => {
  // Access key securely from environment variables.
  const browserKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  const processKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
  
  const key = processKey || browserKey;
  
  if (!key) {
    console.error("CRITICAL: GEMINI_API_KEY is not defined in Secrets or Environment Variables.");
  }
  
  return key;
};

export const hasGeminiApiKey = () => {
  const key = getApiKey();
  return !!key && key.length > 5; // Basic sanity check
};

const ai = new GoogleGenAI({ 
  apiKey: getApiKey() 
});

/**
 * Clean LLM response text that might contain markdown blocks or stray text
 */
function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  // Remove markdown blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '');
  }
  return cleaned;
}

export async function processHandwrittenImage(base64Image: string, mimeType: string = "image/jpeg"): Promise<ExtractionResult> {
  const prompt = `
    Analyze this handwritten ledger and output ONLY a valid JSON object. 
    Do not include any chat or preamble.
    Your job is to READ and STRUCTURE the text.
    Format your response as a JSON object with: 
    - date: (YYYY-MM-DD, assume year 2026)
    - entry_type: "sales", "ev_sessions", or "expenses"
    - entries: list of extracted items with payment_mode ("Fonepay" if "P.P", else "Cash")
    - summary_reasoning: brief explanation
    
    If multiple pages, use a "pages" array with similar structure.
    Sections to find: SN starting lines (EV), middle items (Sales), bottom "Exp" lines (Expenses).
    
    IMPORTANT: Just read the raw text as accurately as possible. Do not perform calculations.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { 
            inlineData: { 
              data: base64Image.split(',')[1] || base64Image, 
              mimeType 
            } 
          },
          { text: prompt }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          entry_type: { type: Type.STRING, description: "Major type of document" },
          date: { type: Type.STRING, description: "Date of first page" },
          total_amount: { type: Type.NUMBER },
          summary_reasoning: { type: Type.STRING },
          entries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["entry_type", "payment_mode", "total_amount"],
              properties: {
                entry_type: { type: Type.STRING, enum: ["sales", "ev_sessions", "expenses"] },
                payment_mode: { type: Type.STRING },
                item_name: { type: Type.STRING },
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                rate: { type: Type.NUMBER },
                total_amount: { type: Type.NUMBER },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
                start_percent: { type: Type.NUMBER },
                end_percent: { type: Type.NUMBER },
                per_percent_rate: { type: Type.NUMBER },
                per_unit_rate: { type: Type.NUMBER },
              }
            }
          },
          pages: { 
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                entries: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                total_amount: { type: Type.NUMBER },
                summary_reasoning: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  try {
    const cleaned = cleanJsonResponse(response.text);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse AI response as JSON. Raw text:", response.text);
    throw new Error("The AI response was malformed. This can happen with very complex images. Please try with a clearer photo or a smaller section.");
  }
}
