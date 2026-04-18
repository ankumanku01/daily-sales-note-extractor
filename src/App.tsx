import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  Plus, 
  Minus, 
  Save, 
  RefreshCcw,
  ExternalLink,
  ChevronRight,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { processHandwrittenImage, type ExtractionResult, hasGeminiApiKey } from './lib/gemini';
import { cn } from './lib/utils';
import { supabase, STORAGE_BUCKET, type EVSessionModel, type SalesRecordModel, type ExpenseRecordModel, type ExtractionLogModel, type ProductRateModel } from './lib/supabase';
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs worker setup
// Using the version same as the library for consistency
const PDFJS_VERSION = '4.0.379'; 
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

export default function App() {
  const [file, setFile] = useState<{ data: string; type: string; name: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<{ hasSheetsId: boolean; hasServiceAccount: boolean; hasAppsScript: boolean; hasGeminiKey: boolean } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; url?: string } | null>(null);
  const [productRates, setProductRates] = useState<ProductRateModel[]>([]);
  const [isManagingRates, setIsManagingRates] = useState(false);
  const [newRate, setNewRate] = useState({ item_name: '', rate: '' });
  const [bulkRates, setBulkRates] = useState('');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [showSetupWarning, setShowSetupWarning] = useState(false);

  React.useEffect(() => {
    const checkSetup = async () => {
      await fetchRates();
      try {
        const res = await fetch('/api/config-status');
        const contentType = res.headers.get("content-type");
        let status;
        if (contentType && contentType.indexOf("application/json") !== -1) {
          status = await res.json();
        } else {
          status = { hasSheetsId: false, hasServiceAccount: false, hasAppsScript: false, hasGeminiKey: hasGeminiApiKey() };
        }
        setConfigStatus(status);
        if (!status.hasGeminiKey) setShowSetupWarning(true);
      } catch (err) {
        console.warn('Backend setup check failed:', err);
        const status = { hasSheetsId: false, hasServiceAccount: false, hasAppsScript: false, hasGeminiKey: hasGeminiApiKey() };
        setConfigStatus(status);
        if (!status.hasGeminiKey) setShowSetupWarning(true);
      }
    };
    
    checkSetup();
  }, []);

  const fetchRates = async () => {
    try {
      const { data, error } = await supabase.from('sales_items').select('*').order('item_name');
      if (error) {
        // Handle table not found (42P01 is PostgreSQL code for undefined_table)
        if (error.code === '42P01') {
          console.warn('Supabase table "sales_items" not found. Using local extraction only.');
          return;
        }
        console.error('Error fetching rates:', error);
        return;
      }
      if (data) setProductRates(data);
    } catch (err) {
      console.warn('Supabase is not reachable or table is missing:', err);
    }
  };

  const addRate = async () => {
    if (!newRate.item_name || !newRate.rate) return;
    
    if (editingRateId) {
      const { error } = await supabase
        .from('sales_items')
        .update({ 
          item_name: newRate.item_name, 
          rate: parseFloat(newRate.rate) 
        })
        .eq('id', editingRateId);
      
      if (!error) {
        setEditingRateId(null);
        setNewRate({ item_name: '', rate: '' });
        fetchRates();
      }
    } else {
      const { error } = await supabase.from('sales_items').insert([{ 
        item_name: newRate.item_name, 
        rate: parseFloat(newRate.rate) 
      }]);
      if (!error) {
        setNewRate({ item_name: '', rate: '' });
        fetchRates();
      }
    }
  };

  const addBulkRates = async () => {
    if (!bulkRates.trim()) return;
    
    const lines = bulkRates.split('\n');
    const toInsert = lines.map(line => {
      const [name, rate] = line.split(/[,\t]/).map(s => s.trim());
      if (name && rate && !isNaN(parseFloat(rate))) {
        return { item_name: name, rate: parseFloat(rate) };
      }
      return null;
    }).filter(Boolean) as any[];

    if (toInsert.length === 0) return;

    const { error } = await supabase.from('sales_items').upsert(toInsert, { onConflict: 'item_name' });
    if (!error) {
      setBulkRates('');
      setIsBulkMode(false);
      fetchRates();
    } else {
      alert('Error saving bulk rates. Ensure item names are unique.');
    }
  };

  const deleteRate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    await supabase.from('sales_items').delete().eq('id', id);
    fetchRates();
  };

  const startEditing = (rate: ProductRateModel) => {
    if (!rate.id) return;
    setEditingRateId(rate.id);
    setNewRate({ item_name: rate.item_name, rate: rate.rate.toString() });
    setIsBulkMode(false);
  };

  const compressImage = async (base64Str: string): Promise<string> => {
    if (base64Str.startsWith('data:application/pdf')) return base64Str;
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1600;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
    });
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setFile({ data: reader.result as string, type: file.type, name: file.name });
        setResult(null);
        setError(null);
        setUploadStatus(null);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const uploadFileToSupabase = async () => {
    if (!file) return null;
    
    // Convert base64 to Blob
    const base64Data = file.data.split(',')[1];
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: file.type });

    const fileName = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, blob);

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const saveToSupabase = async (extraction: ExtractionResult, fileUrl: string | null) => {
    const evSessions: EVSessionModel[] = [];
    const salesRecords: SalesRecordModel[] = [];
    const expenseRecords: ExpenseRecordModel[] = [];

    extraction.entries.forEach(e => {
      const type = (e as any).entry_type || extraction.entry_type;
      
      if (type === 'ev_sessions') {
        evSessions.push({
          session_date: extraction.date,
          start_percent: (e as any).start_percent || 0,
          end_percent: (e as any).end_percent || 0,
          per_percent_rate: (e as any).per_percent_rate || 0,
          per_unit_rate: (e as any).per_unit_rate || 0,
          total_amount: (e as any).total_amount || 0,
          payment_mode: e.payment_mode,
          file_url: fileUrl || undefined
        });
      } else if (type === 'sales') {
        salesRecords.push({
          order_date: extraction.date,
          item_name: (e as any).item_name || 'Unknown',
          quantity: (e as any).quantity || 0,
          rate: (e as any).rate || 0,
          total: (e as any).total_amount || (e as any).total || 0,
          payment_mode: e.payment_mode,
          file_url: fileUrl || undefined
        });
      } else if (type === 'expenses') {
        expenseRecords.push({
          expense_date: extraction.date,
          description: (e as any).description || 'Unknown Expense',
          amount: (e as any).amount || (e as any).total_amount || 0,
          category: (e as any).category,
          payment_mode: e.payment_mode,
          remarks: (e as any).remarks,
          file_url: fileUrl || undefined
        });
      }
    });

    try {
      if (evSessions.length > 0) await supabase.from('ev_sessions').insert(evSessions);
      if (salesRecords.length > 0) await supabase.from('sales_records').insert(salesRecords);
      if (expenseRecords.length > 0) await supabase.from('expense_records').insert(expenseRecords);
      
      // Log extraction
      await supabase.from('extraction_logs').insert({
        file_name: file?.name,
        raw_text: extraction.raw_text || 'Extraction logic bypass',
        file_url: fileUrl || undefined
      });
    } catch (err) {
      console.error('Supabase persistence error:', err);
    }
  };

  const handleProcess = async () => {
    if (!file) return;
    
    // Fail fast if key is missing
    if (!hasGeminiApiKey()) {
      setError('Gemini API Key is missing. Please go to the Gear Icon (top right) -> Secrets -> Add a secret named GEMINI_API_KEY with your key from aistudio.google.com/app/apikey');
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
    // 1. Upload file to bucket
    const fileUrl = await uploadFileToSupabase();
    if (fileUrl) {
      setUploadStatus({ success: true, url: fileUrl });
    } else {
      // If upload fails, we can still try to analyze, but warn the user or log it
      console.warn('Storage upload failed, proceeding with direct analysis.');
    }

      // 2. Run Gemini Extraction
      const optimizedData = await compressImage(file.data);
      const data = await processHandwrittenImage(optimizedData, file.type, productRates.map(r => ({ item_name: r.item_name, rate: r.rate })));
      setResult(data);
      
      // 3. Save to Supabase (separate tables)
      if (data.pages && data.pages.length > 0) {
        for (const page of data.pages) {
          await saveToSupabase(page, fileUrl);
        }
      } else {
        await saveToSupabase(data, fileUrl);
      }
      
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes('leaked') || err.message?.includes('403')) {
        setError('Your API key has been revoked by Google because it was detected in public code. Please generate a NEW key at aistudio.google.com and add it using the Secrets menu (gear icon).');
      } else {
        setError('Failed to process. Please try again.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': ['.jpeg', '.jpg', '.png'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  } as any);

  const handleUpdateEntry = (pageIndex: number | null, entryIndex: number, field: string, value: any) => {
    if (!result) return;
    const newResult = { ...result };
    
    if (pageIndex !== null && newResult.pages) {
      const entries = [...newResult.pages[pageIndex].entries];
      (entries[entryIndex] as any)[field] = value;
      newResult.pages[pageIndex].entries = entries;
    } else {
      const entries = [...newResult.entries];
      (entries[entryIndex] as any)[field] = value;
      newResult.entries = entries;
    }
    
    setResult(newResult);
  };

  const handleSaveToSheets = async () => {
    if (!result) return;
    setIsSaving(true);
    try {
      const response = await fetch('/api/save-to-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_type: result.entry_type,
          date: result.date,
          entries: result.entries,
          total_amount: result.total_amount,
          raw_text: result.raw_text || '',
          file_url: uploadStatus?.url
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save to sheets');
      }

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      
      alert('Data saved to Google Sheets successfully!');
    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleUncertainty = (index: number) => {
    if (!result) return;
    const newEntries = [...result.entries];
    (newEntries[index] as any).uncertain = !(newEntries[index] as any).uncertain;
    setResult({ ...result, entries: newEntries });
  };

  const updateCategory = (index: number, newCategory: string) => {
    if (!result) return;
    const newEntries = [...result.entries];
    (newEntries[index] as any).category = newCategory;
    setResult({ ...result, entries: newEntries });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-orange-100">
      {/* Setup Warning */}
      <AnimatePresence>
        {showSetupWarning && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="bg-orange-500 overflow-hidden"
          >
            <div className="max-w-5xl mx-auto px-6 py-2 flex items-center justify-between text-white text-xs font-medium">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} />
                <span>Gemini API Key is missing. AI analysis will not work until you add it.</span>
              </div>
              <button 
                onClick={() => {
                  window.alert("Go to the Gear Icon (top right) -> Secrets -> Add a secret named GEMINI_API_KEY");
                }}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
              >
                How to fix <ChevronRight size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white">
              <FileText size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">Nepali Finance Extractor</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsManagingRates(true)}
              className="text-sm text-gray-500 hover:text-orange-600 flex items-center gap-1 transition-colors"
            >
              Item Rates <Plus size={14} />
            </button>
            <a 
              href="https://docs.google.com/spreadsheets/d/1_9K7TmzhSp5pbNJjUw7giomvf0gPU953KquKgpD6RZU/edit?usp=sharing" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-colors"
            >
              View Sheet <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">Upload Handwritten Note</h2>
              
              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-3",
                  isDragActive ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50",
                  file ? "py-4" : "py-12"
                )}
              >
                <input {...getInputProps()} />
                {file ? (
                  <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden border border-gray-100">
                    {file.type === 'application/pdf' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-red-500">
                        <FileText size={48} />
                        <p className="text-xs font-bold mt-2 uppercase text-gray-400">PDF Document</p>
                      </div>
                    ) : (
                      <img src={file.data} alt="Preview" className="w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <p className="text-white text-sm font-medium">Change File</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                      <Upload size={24} />
                    </div>
                    <div>
                      <p className="font-medium">Click or drag file here</p>
                      <p className="text-xs text-gray-400 mt-1">Images or PDFs (Handwritten Notes)</p>
                    </div>
                  </>
                )}
              </div>

              {file && !result && (
                <div className="space-y-4 mt-6">
                  {!hasGeminiApiKey() && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm">
                      <p className="font-bold flex items-center gap-2 mb-1">
                        <AlertCircle size={16} /> Gemini API Key Missing
                      </p>
                      <p>To use this on Vercel, you must set <code className="bg-orange-100 px-1 rounded">VITE_GEMINI_API_KEY</code> in your environment variables.</p>
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-orange-600 font-bold underline block mt-2">Get Free API Key here →</a>
                    </div>
                  )}
                  
                  <button
                    onClick={handleProcess}
                    disabled={isProcessing || !hasGeminiApiKey()}
                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-200"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCcw size={18} className="animate-spin" />
                        <div className="flex flex-col items-start leading-tight">
                          <span className="text-sm">Analyzing Text...</span>
                          <span className="text-[10px] opacity-80 font-normal italic">Can take 15-30s</span>
                        </div>
                      </>
                    ) : (
                      <>
                        Analyze with AI
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <HelpCircle size={16} className="text-gray-400" />
                How it works
              </h3>
              <ul className="space-y-3 text-sm text-gray-500">
                <li className="flex gap-2">
                  <span className="text-orange-500 font-bold">01</span>
                  Upload a photo of your handwritten expenses or income.
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-500 font-bold">02</span>
                  AI extracts text and classifies entries automatically.
                </li>
                <li className="flex gap-2">
                  <span className="text-orange-500 font-bold">03</span>
                  Review the breakdown and save to your Google Sheet.
                </li>
              </ul>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {!result ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-full flex flex-col items-center justify-center text-center p-12 bg-white/50 rounded-3xl border border-dashed border-gray-200"
                >
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-300 mb-4">
                    <FileText size={32} />
                  </div>
                  <h2 className="text-xl font-medium text-gray-400">Analysis results will appear here</h2>
                  <p className="text-sm text-gray-400 mt-2 max-w-xs">Upload an image and click analyze to see the financial breakdown.</p>
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Extraction Result</h2>
                      <p className="text-gray-500 text-sm mt-1 flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-green-500" />
                        Processed {result.pages?.length || 1} pages reliably
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {uploadStatus?.url && (
                        <a 
                          href={uploadStatus.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-xl transition-all"
                        >
                          <ExternalLink size={16} />
                          View Original
                        </a>
                      )}
                      <button
                        onClick={() => setIsEditing(!isEditing)}
                        className={cn(
                          "inline-flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all shadow-sm",
                          isEditing ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                        )}
                      >
                        {isEditing ? <Save size={16} /> : <AlertCircle size={16} />}
                        {isEditing ? "Finish Editing" : "Edit Entries"}
                      </button>
                    </div>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Entry Type</p>
                      <p className="text-xl font-semibold text-orange-500 capitalize">
                        {result.entry_type.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Total Amount</p>
                      <p className="text-2xl font-semibold text-blue-600 flex items-baseline gap-1">
                        <span className="text-sm font-normal">Rs.</span>{result.total_amount}
                      </p>
                    </div>
                  </div>

                  {/* AI Human-like Interpretation */}
                  <div className="bg-orange-50 rounded-2xl p-6 border border-orange-100">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-3 flex items-center gap-2">
                      <HelpCircle size={14} /> AI Interpretation
                    </h3>
                    <p className="text-sm text-orange-900 leading-relaxed italic">
                      "{result.summary_reasoning}"
                    </p>
                  </div>

                  {/* Detailed Breakdown */}
                  <div className="space-y-8">
                    {(result.pages && result.pages.length > 0 ? result.pages : [result]).map((pageResult, pageIdx) => (
                      <div key={pageIdx} className="space-y-4">
                        {result.pages && <h2 className="text-lg font-bold text-gray-900 border-l-4 border-orange-500 pl-3">Day {pageIdx + 1}: {pageResult.date}</h2>}
                        {['sales', 'ev_sessions', 'expenses'].map(type => {
                          const typeEntries = pageResult.entries.filter(e => (e as any).entry_type === type || (!e.hasOwnProperty('entry_type') && pageResult.entry_type === type));
                          if (typeEntries.length === 0) return null;

                          return (
                            <div key={type} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                              <div className="px-4 sm:px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <h3 className="font-semibold text-sm capitalize">{type.replace('_', ' ')} Records ({pageResult.date})</h3>
                                <span className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full font-bold text-gray-500 uppercase">
                                  {typeEntries.length} Entries
                                </span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="bg-gray-50/50 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                                      {type === 'sales' && (
                                        <>
                                          <th className="px-6 py-3">Item</th>
                                          <th className="px-4 py-3 text-right">Qty</th>
                                          <th className="px-4 py-3 text-right">Rate</th>
                                          <th className="px-4 py-3 text-right">Total</th>
                                          <th className="px-4 py-3 text-center">Mode</th>
                                        </>
                                      )}
                                      {type === 'ev_sessions' && (
                                        <>
                                          <th className="px-6 py-3">Range (%)</th>
                                          <th className="px-4 py-3 text-center">Diff</th>
                                          <th className="px-4 py-3 text-right">Rate</th>
                                          <th className="px-4 py-3 text-right">Total</th>
                                          <th className="px-4 py-3 text-center">Mode</th>
                                        </>
                                      )}
                                      {type === 'expenses' && (
                                        <>
                                          <th className="px-6 py-3">Description</th>
                                          <th className="px-4 py-3 text-right">Amount</th>
                                          <th className="px-4 py-3 text-center">Category</th>
                                          <th className="px-4 py-3 text-center">Mode</th>
                                        </>
                                      )}
                                      {isEditing && <th className="px-4 py-3 text-center">Edit</th>}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 bg-white">
                                    {typeEntries.map((originalEntry: any, originalIdx) => {
                                      // Find correct index in global list if single page, or page list
                                      const entry = originalEntry;
                                      const idx = pageResult.entries.indexOf(originalEntry);
                                      const pIdx = result.pages ? pageIdx : null;

                                      return (
                                        <tr key={idx} className="hover:bg-gray-50/50 transition-colors group">
                                          {type === 'sales' && (
                                            <>
                                              <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                                {isEditing ? (
                                                  <input 
                                                    type="text" 
                                                    className="w-full border rounded px-1" 
                                                    value={entry.item_name} 
                                                    onChange={(e) => handleUpdateEntry(pIdx, idx, 'item_name', e.target.value)}
                                                  />
                                                ) : entry.item_name}
                                              </td>
                                              <td className="px-4 py-4 text-sm font-mono text-right text-gray-600">
                                                {isEditing ? (
                                                  <input 
                                                    type="number" 
                                                    className="w-16 border rounded px-1 text-right" 
                                                    value={entry.quantity} 
                                                    onChange={(e) => handleUpdateEntry(pIdx, idx, 'quantity', Number(e.target.value))}
                                                  />
                                                ) : (entry.quantity || 0)}
                                              </td>
                                              <td className="px-4 py-4 text-sm font-mono text-right text-gray-600">{entry.rate || 0}</td>
                                              <td className="px-4 py-4 text-sm font-semibold font-mono text-right text-blue-600">{(entry.total_amount || entry.total || entry.amount || 0)}</td>
                                              <td className="px-4 py-4 text-center">
                                                <span className={cn(
                                                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                                                  entry.payment_mode === 'Fonepay' ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"
                                                )}>
                                                  {entry.payment_mode || 'Cash'}
                                                </span>
                                              </td>
                                            </>
                                          )}
                                          {type === 'ev_sessions' && (
                                            <>
                                              <td className="px-6 py-4 text-sm font-mono text-gray-600">
                                                {isEditing ? (
                                                  <div className="flex items-center gap-1">
                                                    <input type="number" className="w-12 border rounded px-1" value={entry.start_percent} onChange={(e) => handleUpdateEntry(pIdx, idx, 'start_percent', Number(e.target.value))} />
                                                    <span>→</span>
                                                    <input type="number" className="w-12 border rounded px-1" value={entry.end_percent} onChange={(e) => handleUpdateEntry(pIdx, idx, 'end_percent', Number(e.target.value))} />
                                                  </div>
                                                ) : (
                                                  <>
                                                    <span className="opacity-50">{entry.start_percent || 0}%</span>
                                                    <span className="mx-2 opacity-30">→</span>
                                                    <span className="text-gray-900 font-bold">{entry.end_percent || 0}%</span>
                                                  </>
                                                )}
                                              </td>
                                              <td className="px-4 py-4 text-sm font-mono text-center text-gray-400">
                                                {Math.max(0, (entry.end_percent || 0) - (entry.start_percent || 0))}%
                                              </td>
                                              <td className="px-4 py-4 text-sm font-mono text-right text-gray-500 whitespace-nowrap">
                                                x {(entry.per_percent_rate || entry.per_unit_rate || 0)}
                                              </td>
                                              <td className="px-4 py-4 text-sm font-semibold font-mono text-right text-blue-600">
                                                {(entry.total_amount || entry.amount || entry.total || 0)}
                                              </td>
                                              <td className="px-4 py-4 text-center">
                                                <span className={cn(
                                                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                                                  entry.payment_mode === 'Fonepay' ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"
                                                )}>
                                                  {entry.payment_mode || 'Cash'}
                                                </span>
                                              </td>
                                            </>
                                          )}
                                          {type === 'expenses' && (
                                            <>
                                              <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                                {isEditing ? (
                                                  <input type="text" className="w-full border rounded px-1" value={entry.description} onChange={(e) => handleUpdateEntry(pIdx, idx, 'description', e.target.value)} />
                                                ) : entry.description}
                                              </td>
                                              <td className="px-4 py-4 text-sm font-semibold font-mono text-right text-red-600">
                                                {isEditing ? (
                                                  <input type="number" className="w-20 border rounded px-1 text-right" value={entry.amount} onChange={(e) => handleUpdateEntry(pIdx, idx, 'amount', Number(e.target.value))} />
                                                ) : (entry.amount || entry.total_amount || entry.total || 0)}
                                              </td>
                                              <td className="px-4 py-4 text-center">
                                                <span className="text-[10px] px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full font-bold uppercase tracking-wider">
                                                  {entry.category || 'Utility'}
                                                </span>
                                              </td>
                                              <td className="px-4 py-4 text-center">
                                                <span className={cn(
                                                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider",
                                                  entry.payment_mode === 'Fonepay' ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500"
                                                )}>
                                                  {entry.payment_mode || 'Cash'}
                                                </span>
                                              </td>
                                            </>
                                          )}
                                          {isEditing && <td className="px-4 py-4 text-center"><AlertCircle size={14} className="text-gray-300 mx-auto" /></td>}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Raw Text */}
                  {result.raw_text && (
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Raw Extracted Text</h3>
                      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 font-mono whitespace-pre-wrap border border-gray-100">
                        {result.raw_text}
                      </div>
                    </div>
                  )}

                  {/* Action Footer */}
                  <div className="flex items-center gap-4 pt-4">
                    <button
                      onClick={() => {
                        setResult(null);
                        setFile(null);
                        setIsEditing(false);
                      }}
                      className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCcw size={18} />
                      Start Over
                    </button>
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className={cn(
                        "flex-1 font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 border",
                        isEditing ? "bg-orange-50 border-orange-200 text-orange-600" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      <RefreshCcw size={18} className={cn(isEditing && "animate-spin")} />
                      {isEditing ? 'Finish Editing' : 'Edit Entries'}
                    </button>
                    <button
                      onClick={handleSaveToSheets}
                      disabled={isSaving}
                      className="flex-[2] bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-gray-200"
                    >
                      {isSaving ? (
                        <RefreshCcw size={18} className="animate-spin" />
                      ) : (
                        <Save size={18} />
                      )}
                      Save to Google Sheets
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Item Rates Modal */}
      <AnimatePresence>
        {isManagingRates && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsManagingRates(false);
                setEditingRateId(null);
                setNewRate({ item_name: '', rate: '' });
              }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Price List Management</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Define item rates for AI matching</p>
                </div>
                <button 
                  onClick={() => {
                    setIsManagingRates(false);
                    setEditingRateId(null);
                    setNewRate({ item_name: '', rate: '' });
                  }} 
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white transition-colors text-gray-400"
                >
                  <RefreshCcw size={18} className="rotate-45" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
                  <button 
                    onClick={() => setIsBulkMode(false)}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all",
                      !isBulkMode ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                    )}
                  >
                    Single Entry
                  </button>
                  <button 
                    onClick={() => setIsBulkMode(true)}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all",
                      isBulkMode ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
                    )}
                  >
                    Bulk Import
                  </button>
                </div>

                {!isBulkMode ? (
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="e.g. Americano" 
                      value={newRate.item_name}
                      onChange={e => setNewRate({...newRate, item_name: e.target.value})}
                      className="flex-1 text-sm border-gray-200 rounded-xl focus:ring-orange-500 focus:border-orange-500 h-10"
                    />
                    <input 
                      type="number" 
                      placeholder="Rate" 
                      value={newRate.rate}
                      onChange={e => setNewRate({...newRate, rate: e.target.value})}
                      className="w-24 text-sm border-gray-200 rounded-xl focus:ring-orange-500 focus:border-orange-500 h-10"
                    />
                    <button 
                      onClick={addRate}
                      className={cn(
                        "text-white px-4 rounded-xl transition-all h-10 flex items-center gap-2",
                        editingRateId ? "bg-blue-600 hover:bg-blue-700" : "bg-orange-500 hover:bg-orange-600"
                      )}
                    >
                      {editingRateId ? <Save size={18} /> : <Plus size={18} />}
                      {editingRateId ? 'Update' : 'Add'}
                    </button>
                    {editingRateId && (
                      <button 
                        onClick={() => {
                          setEditingRateId(null);
                          setNewRate({ item_name: '', rate: ''});
                        }}
                        className="bg-gray-100 text-gray-500 px-4 rounded-xl hover:bg-gray-200 h-10"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative">
                      <textarea 
                        placeholder="Item Name, Rate&#10;Burger, 250&#10;Pizza, 450"
                        value={bulkRates}
                        onChange={e => setBulkRates(e.target.value)}
                        className="w-full h-32 text-sm border-gray-200 rounded-xl focus:ring-orange-500 focus:border-orange-500 p-3 font-mono"
                      />
                      <p className="text-[10px] text-gray-400 mt-1 italic">Format: Item Name, Rate (one per line). Names must be unique.</p>
                    </div>
                    <button 
                      onClick={addBulkRates}
                      className="w-full bg-orange-500 text-white font-semibold py-2 rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={16} />
                      Process Bulk Import
                    </button>
                  </div>
                )}
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current Price List</h3>
                    <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{productRates.length} Items</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                    {productRates.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                        <FileText size={40} className="mb-2 opacity-20" />
                        <p className="text-sm italic">No rates defined yet.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {productRates.map(rate => (
                          <div key={rate.id} className={cn(
                            "flex items-center justify-between p-3 rounded-2xl group transition-all",
                            editingRateId === rate.id ? "bg-blue-50 border border-blue-100" : "bg-gray-50 border border-transparent hover:border-gray-200"
                          )}>
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold",
                                editingRateId === rate.id ? "bg-blue-100 text-blue-600" : "bg-white text-gray-400"
                              )}>
                                {rate.item_name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-gray-900 leading-none">{rate.item_name}</p>
                                <p className="text-xs text-orange-600 font-mono mt-1">Rs. {rate.rate}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => startEditing(rate)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-100 text-blue-600 transition-all"
                                title="Edit"
                              >
                                <RefreshCcw size={16} />
                              </button>
                              <button 
                                onClick={() => rate.id && deleteRate(rate.id)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-500 transition-all"
                                title="Delete"
                              >
                                <Minus size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
