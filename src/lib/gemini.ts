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
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function processHandwrittenImage(base64Image: string, mimeType: string = "image/jpeg"): Promise<ExtractionResult> {
  const prompt = `
    You are an expert financial auditor reading a handwritten ledger page. 
    The page is very dense and contains three distinct sections that MUST all be extracted:

    SECTION 1: EV CHARGING LOG (Handwritten lines starting with Serial Numbers)
    - Pattern: [S.N] [Starting %] - [Ending %] (x [Rate])
    - MANDATORY: If you can calculate a total, you MUST have extracted the components.
    - EXTRACT AND POPULATE THESE KEYS FOR EVERY 'ev_sessions' ROW:
      1. start_percent: The first % number (e.g., 57)
      2. end_percent: The second % number (e.g., 99)
      3. per_percent_rate: The rate inside/after the braces (e.g., 6)
      4. total_amount: (end_percent - start_percent) * per_percent_rate
      5. per_unit_rate: Set this to the same value as per_percent_rate.
    - **CRITICAL**: If total_amount is 252, start_percent MUST be 57, end_percent MUST be 99, and per_percent_rate MUST be 6. DO NOT LEAVE THEM AS 0.

    SECTION 2: SALES / ORDERS (Product names followed by quantities)
    - Pattern: [Product] - [Quantity, Quantity, ...]
    - MANDATORY FIELDS FOR 'sales':
      - item_name, quantity (Sum of numbers), total_amount (calculated total).
    - payment_mode: If "P.P" then "Fonepay", else "Cash".

    SECTION 3: DAILY EXPENSES (Entries under "Exp" header)
    - Pattern: [Item] - [Price]
    - MANDATORY FIELDS FOR 'expenses':
      - description, amount (MUST be the price seen), payment_mode.

    CRITICAL REQUIREMENTS:
    - IGNORE NOTHING: Scan every line on the page.
    - NO ZEROS: If you found the numbers to calculate the total, you MUST return those numbers in the JSON.
    - DATES: Find "7 Apr" or "8 Apr" and force year to 2026 (YYYY-MM-DD).
    - CURRENCY: All amounts are in Rs. (NPR).

    Return all extracted items in the 'entries' array.
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
        required: ["entry_type", "date", "entries", "total_amount", "summary_reasoning", "raw_text"],
        properties: {
          entry_type: { type: Type.STRING, description: "One of: 'sales', 'ev_sessions', 'expenses'" },
          date: { type: Type.STRING, description: "The date of the entries in YYYY-MM-DD format" },
          total_amount: { type: Type.NUMBER },
          summary_reasoning: { type: Type.STRING },
          raw_text: { type: Type.STRING, description: "Complete raw text extracted from the image" },
          entries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["entry_type", "payment_mode", "start_percent", "end_percent", "per_percent_rate", "total_amount"],
              properties: {
                entry_type: { type: Type.STRING, enum: ["sales", "ev_sessions", "expenses"] },
                payment_mode: { type: Type.STRING },
                item_name: { type: Type.STRING },
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                rate: { type: Type.NUMBER },
                total_amount: { type: Type.NUMBER, description: "Total for this specific line item. Mandatory for calculations." },
                amount: { type: Type.NUMBER, description: "Amount for expenses" },
                category: { type: Type.STRING },
                start_percent: { type: Type.NUMBER, description: "Available for EV sessions. Must not be 0 if present in text." },
                end_percent: { type: Type.NUMBER, description: "Available for EV sessions. Must not be 0 if present in text." },
                kcal: { type: Type.NUMBER },
                per_unit_rate: { type: Type.NUMBER },
                per_percent_rate: { type: Type.NUMBER, description: "Rate per percent for EV. Must not be 0 if present in text." },
                remarks: { type: Type.STRING },
                uncertain: { type: Type.BOOLEAN },
                reasoning: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text.trim());
}
