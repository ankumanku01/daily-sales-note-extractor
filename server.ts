import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get('/api/config-status', (req, res) => {
    res.json({
      hasSheetsId: !!process.env.GOOGLE_SHEETS_ID,
      hasServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      hasAppsScript: !!process.env.GOOGLE_APPS_SCRIPT_URL,
      hasGeminiKey: !!process.env.GEMINI_API_KEY
    });
  });

  app.post('/api/save-to-sheets', async (req, res) => {
    try {
      const { entry_type, date, entries, total_amount, raw_text, file_url } = req.body;
      
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

      // Group entries by type for batch processing
      const groupedEntries = entries.reduce((acc: any, entry: any) => {
        const type = entry.entry_type || entry_type || 'expenses'; 
        if (!acc[type]) acc[type] = [];
        acc[type].push(entry);
        return acc;
      }, {});

      // Method 1: Google Apps Script
      if (appsScriptUrl) {
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entry_type, 
            date,
            entries,
            total_amount,
            rawText: raw_text,
            file_url
          })
        });
        
        if (!response.ok) throw new Error('Apps Script returned an error');
        return res.json({ success: true });
      }

      // Method 2: Service Account
      if (!spreadsheetId || !serviceAccountKey) {
        return res.status(400).json({ error: 'Google Sheets configuration missing' });
      }

      const auth = new GoogleAuth({
        credentials: JSON.parse(serviceAccountKey),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      
      for (const [type, typeEntries] of Object.entries(groupedEntries)) {
        let targetRange = '';
        let rowValues = [];

        if (type === 'sales') {
          targetRange = 'Sales!A:G';
          // Format: item_name, quantity, rate, total, payment_mode, order_date, file_url
          rowValues = (typeEntries as any).map((e: any) => [
            e.item_name || '', 
            e.quantity || 0, 
            e.rate || 0, 
            e.total || e.amount || e.total_amount || 0, 
            e.payment_mode || 'Cash', 
            date,
            file_url || ''
          ]);
        } else if (type === 'ev_sessions') {
          targetRange = 'EVSessions!A:J';
          // Format: total_amount, payment_mode, category, start_percent, end_percent, kcal, per_unit_rate, per_percent_rate, session_date, file_url
          rowValues = (typeEntries as any).map((e: any) => [
            e.total_amount || e.amount || e.total || 0, 
            e.payment_mode || 'Cash', 
            e.category || 'EV', 
            e.start_percent || 0, 
            e.end_percent || 0, 
            e.kcal || 0, 
            e.per_unit_rate || 0, 
            e.per_percent_rate || 0, 
            date,
            file_url || ''
          ]);
        } else if (type === 'expenses') {
          targetRange = 'Expenses!A:G';
          // Format: description, amount, category, payment_mode, remarks, expense_date, file_url
          rowValues = (typeEntries as any).map((e: any) => [
            e.description || e.item_name || '', 
            e.amount || e.total || e.total_amount || 0, 
            e.category || '', 
            e.payment_mode || 'Cash', 
            e.remarks || '', 
            date,
            file_url || ''
          ]);
        }

        if (targetRange && rowValues.length > 0) {
          try {
            await sheets.spreadsheets.values.append({
              spreadsheetId,
              range: targetRange,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: rowValues },
            });
          } catch (e) {
            console.error(`Error appending to ${targetRange}:`, e);
          }
        }
      }

      // Also save raw text to RawData
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'RawData!A:C',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[date, raw_text, file_url]] },
        });
      } catch (e) {}

      res.json({ success: true });
    } catch (error: any) {
      console.error('Sheets Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
