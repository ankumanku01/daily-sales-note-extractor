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
  raw_text: string;
  pages?: ExtractionResult[]; // For multi-day PDFs
}

const getApiKey = () => {
  const browserKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  const processKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
  // If user wants to hardcode for Vercel, they can replace the string below
  return browserKey || processKey || ""; 
};

const ai = new GoogleGenAI({ 
  apiKey: getApiKey() 
});

export async function processHandwrittenImage(base64Image: string, mimeType: string = "image/jpeg"): Promise<ExtractionResult> {
  const prompt = `
    You are an expert financial auditor reading a handwritten ledger. 
    The file provided might be a single page (image) or multiple pages (PDF).
    
    FOR EACH PAGE IN THE DOCUMENT:
    1. Identify the Date at the top left (e.g., "7 Apr"). Force year to 2026 (YYYY-MM-DD).
    2. Extract three distinct sections:

    SECTION 1: EV CHARGING LOG (Handwritten lines starting with Serial Numbers)
    - Pattern: [S.N] [Starting %] - [Ending %] (x [Rate])
    - EXTRACT AND POPULATE: start_percent, end_percent, per_percent_rate, total_amount (calculated), per_unit_rate.
    - CRITICAL: NO ZEROS for these fields if present in text.

    SECTION 2: SALES / ORDERS (Middle section)
    - Extract: item_name, quantity (Sum of numbers), total_amount.

    SECTION 3: DAILY EXPENSES (Bottom section starting with "Exp")
    - Extract: description, amount, payment_mode.

    CRITICAL REQUIREMENTS:
    - If this is a multi-page PDF, return a list of extracted pages in the 'pages' array.
    - JSON CONSISTENCY: Every entry must match the schema exactly.
    - "P.P" = "Fonepay", default is "Cash".
    - Convert Nepali numerals to English.
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
          raw_text: { type: Type.STRING },
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

  return JSON.parse(response.text.trim());
}
