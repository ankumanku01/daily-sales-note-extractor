-- Table for EV Charging Sessions
CREATE TABLE IF NOT EXISTS ev_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  session_date DATE NOT NULL,
  start_percent NUMERIC,
  end_percent NUMERIC,
  per_percent_rate NUMERIC,
  per_unit_rate NUMERIC,
  total_amount NUMERIC,
  payment_mode TEXT,
  remarks TEXT,
  file_url TEXT -- To link to the stored image/pdf
);

-- Table for Sales Records
CREATE TABLE IF NOT EXISTS sales_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  order_date DATE NOT NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC,
  rate NUMERIC,
  total NUMERIC,
  payment_mode TEXT,
  file_url TEXT
);

-- Table for Expense Records
CREATE TABLE IF NOT EXISTS expense_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  expense_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC,
  category TEXT,
  payment_mode TEXT,
  remarks TEXT,
  file_url TEXT
);

-- Table for Raw Extraction Data
CREATE TABLE IF NOT EXISTS extraction_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  file_name TEXT,
  raw_text TEXT,
  file_url TEXT
);

-- Enable Row Level Security (RLS)
ALTER TABLE ev_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_logs ENABLE ROW LEVEL SECURITY;

-- Create policy for public access
CREATE POLICY "Public full access ev" ON ev_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access sales" ON sales_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access expenses" ON expense_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public full access logs" ON extraction_logs FOR ALL USING (true) WITH CHECK (true);

-- STORAGE SETUP
-- Note: Buckets are often created via the Supabase UI, 
-- but you can use the storage schema if you have permissions.
-- INSERT INTO storage.buckets (id, name, public) VALUES ('extracted-docs', 'extracted-docs', true);

-- ALLOW PUBLIC UPLOADS TO THE BUCKET
CREATE POLICY "Public Upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'extracted-docs' );

-- ALLOW PUBLIC ACCESS TO VIEW FILES
CREATE POLICY "Public View"
ON storage.objects FOR SELECT
USING ( bucket_id = 'extracted-docs' );

-- ALLOW PUBLIC UPDATE (to overwrite or modify if needed)
CREATE POLICY "Public Update"
ON storage.objects FOR UPDATE
WITH CHECK ( bucket_id = 'extracted-docs' );
