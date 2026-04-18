import { GoogleGenAI, Type } from "@google/genai";

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

const getApiKey = () => {
  // HARDCODE YOUR GEMINI API KEY HERE FOR VERCEL:
  const HARDCODED_GEMINI_KEY = "AIzaSyDGvao3dbYxWTkM1tJ4-ipVegT56odcI2s"; 
  
  const browserKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  const processKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
  
  return browserKey || processKey || HARDCODED_GEMINI_KEY; 
};

export const hasGeminiApiKey = () => !!getApiKey();

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

export async function processHandwrittenImage(base64Image: string, mimeType: string = "image/jpeg", priceList?: { item_name: string, rate: number }[]): Promise<ExtractionResult> {
  const priceListStr = priceList && priceList.length > 0 
    ? `\n\nUSE THESE ITEM RATES FOR 'SALES' MATCHING (Match item name, if not listed, extract from image):\n${priceList.map(p => `- ${p.item_name}: Rs. ${p.rate}`).join('\n')}`
    : '';

  const prompt = `
    Analyze this handwritten ledger and output JSON.
    Format your response as a JSON object with: 
    - date: (YYYY-MM-DD, assume year 2026)
    - entry_type: "sales", "ev_sessions", or "expenses"
    - total_amount: numeric total
    - entries: list of extracted items with payment_mode ("Fonepay" if "P.P", else "Cash")
    - summary_reasoning: brief explanation
    
    If multiple pages, use a "pages" array with similar structure.
    Sections to find: SN starting lines (EV), middle items (Sales), bottom "Exp" lines (Expenses).${priceListStr}
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
