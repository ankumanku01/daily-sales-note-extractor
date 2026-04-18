# Project: Nepali Finance Extractor

## Configuration Requirements

This app requires several API keys to function correctly. **DO NOT HARDCODE THEM.** Always use the **Secrets** menu in AI Studio.

### Required Secrets
1. `GEMINI_API_KEY`: Get from [aistudio.google.com](https://aistudio.google.com/app/apikey).
2. `VITE_SUPABASE_URL`: (Optional - already configured for this project).
3. `VITE_SUPABASE_ANON_KEY`: (Optional - already configured for this project).

### Vercel Deployment
To deploy on Vercel:
1. Set `VITE_GEMINI_API_KEY` in Vercel Environment Variables.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Design Notes
- The app uses `gemini-3-flash-preview` for extraction.
- Images are compressed client-side before processing to reduce latency.
- Supabase is used for logging and session persistence.
- Google Sheets integration uses either Apps Script (preferred) or a Service Account.
