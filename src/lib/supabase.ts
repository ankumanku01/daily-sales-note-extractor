import { createClient } from '@supabase/supabase-js';

const getEnv = (key: string) => {
  const envMap: Record<string, string> = {
    'VITE_SUPABASE_URL': 'https://snnxbgvvfuceswacfptf.supabase.co',
    'VITE_SUPABASE_ANON_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNubnhiZ3Z2ZnVjZXN3YWNmcHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MjE0NTQsImV4cCI6MjA5MjA5NzQ1NH0._E8RekbOGfFE3i0w0GD6WebS9G_kR7i9IVc3ISSseOQ'
  };
  return (import.meta as any).env[key] || (typeof process !== 'undefined' ? process.env[key] : undefined) || envMap[key];
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

export const STORAGE_BUCKET = 'extracted-docs';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
);

export interface EVSessionModel {
  id?: string;
  session_date: string;
  start_percent: number;
  end_percent: number;
  per_percent_rate: number;
  per_unit_rate: number;
  total_amount: number;
  payment_mode: string;
  remarks?: string;
  file_url?: string;
}

export interface SalesRecordModel {
  id?: string;
  order_date: string;
  item_name: string;
  quantity: number;
  rate: number;
  total: number;
  payment_mode: string;
  file_url?: string;
}

export interface ExpenseRecordModel {
  id?: string;
  expense_date: string;
  description: string;
  amount: number;
  category?: string;
  payment_mode: string;
  remarks?: string;
  file_url?: string;
}

export interface ExtractionLogModel {
  id?: string;
  file_name?: string;
  raw_text: string;
  file_url?: string;
}
