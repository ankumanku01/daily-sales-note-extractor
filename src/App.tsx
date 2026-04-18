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
import { processHandwrittenImage, type ExtractionResult } from './lib/gemini';
import { cn } from './lib/utils';

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<{ hasSheetsId: boolean; hasServiceAccount: boolean; hasAppsScript: boolean; hasGeminiKey: boolean } | null>(null);

  React.useEffect(() => {
    fetch('/api/config-status')
      .then(res => res.json())
      .then(setConfigStatus)
      .catch(console.error);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImage(reader.result as string);
        setResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png'] },
    multiple: false
  } as any);

  const handleProcess = async () => {
    if (!image) return;
    setIsProcessing(true);
    setError(null);
    try {
      const data = await processHandwrittenImage(image);
      setResult(data);
    } catch (err: any) {
      console.error(err);
      setError('Failed to process image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
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
          raw_text: result.raw_text
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
    const newExpenses = [...result.expenses];
    newExpenses[index].uncertain = !newExpenses[index].uncertain;
    setResult({ ...result, expenses: newExpenses });
  };

  const updateCategory = (index: number, newCategory: string) => {
    if (!result) return;
    const newExpenses = [...result.expenses];
    newExpenses[index].category = newCategory;
    setResult({ ...result, expenses: newExpenses });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-orange-100">
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
                  image ? "py-4" : "py-12"
                )}
              >
                <input {...getInputProps()} />
                {image ? (
                  <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden border border-gray-100">
                    <img src={image} alt="Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <p className="text-white text-sm font-medium">Change Image</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                      <Upload size={24} />
                    </div>
                    <div>
                      <p className="font-medium">Click or drag image here</p>
                      <p className="text-xs text-gray-400 mt-1">Supports JPG, PNG (Handwritten Nepali/English)</p>
                    </div>
                  </>
                )}
              </div>

              {image && !result && (
                <button
                  onClick={handleProcess}
                  disabled={isProcessing}
                  className="w-full mt-6 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-200"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCcw size={18} className="animate-spin" />
                      Analyzing Text...
                    </>
                  ) : (
                    <>
                      Analyze with AI
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
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
                    {['sales', 'ev_sessions', 'expenses'].map(type => {
                      const typeEntries = result.entries.filter(e => (e as any).entry_type === type || (!e.hasOwnProperty('entry_type') && result.entry_type === type));
                      if (typeEntries.length === 0) return null;

                      return (
                        <div key={type} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                          <div className="px-4 sm:px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                            <h3 className="font-semibold text-sm capitalize">{type.replace('_', ' ')} Records ({result.date})</h3>
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
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50 bg-white">
                                {typeEntries.map((entry: any, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50/50 transition-colors group">
                                    {type === 'sales' && (
                                      <>
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{entry.item_name}</td>
                                        <td className="px-4 py-4 text-sm font-mono text-right text-gray-600">{entry.quantity || 0}</td>
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
                                          <span className="opacity-50">{entry.start_percent || 0}%</span>
                                          <span className="mx-2 opacity-30">→</span>
                                          <span className="text-gray-900 font-bold">{entry.end_percent || 0}%</span>
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
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{entry.description}</td>
                                        <td className="px-4 py-4 text-sm font-semibold font-mono text-right text-red-600">
                                          {(entry.amount || entry.total_amount || entry.total || 0)}
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
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Raw Text */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Raw Extracted Text</h3>
                    <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 font-mono whitespace-pre-wrap border border-gray-100">
                      {result.raw_text}
                    </div>
                  </div>

                  {/* Action Footer */}
                  <div className="flex items-center gap-4 pt-4">
                    <button
                      onClick={() => {
                        setResult(null);
                        setImage(null);
                      }}
                      className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCcw size={18} />
                      Start Over
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

      {/* Setup Instructions Overlay (if env missing) */}
      {(!process.env.GEMINI_API_KEY || (configStatus && !configStatus.hasAppsScript && (!configStatus.hasSheetsId || !configStatus.hasServiceAccount))) && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-gray-100 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Configuration Required</h2>
            <div className="text-gray-500 mb-6 space-y-4 text-sm text-left">
              {!process.env.GEMINI_API_KEY && (
                <p>• Set <code className="bg-gray-100 px-1 rounded">GEMINI_API_KEY</code> in Secrets.</p>
              )}
              {configStatus && !configStatus.hasAppsScript && (
                <div className="space-y-2">
                  <p className="font-bold text-gray-700">To save to Sheets, you need EITHER:</p>
                  <div className="pl-4 space-y-2">
                    <p>1. <code className="bg-gray-100 px-1 rounded">GOOGLE_APPS_SCRIPT_URL</code> (Easiest! No Cloud Console needed)</p>
                    <p className="text-xs text-gray-400">OR</p>
                    <p>2. <code className="bg-gray-100 px-1 rounded">GOOGLE_SHEETS_ID</code> AND <code className="bg-gray-100 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_KEY</code></p>
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors"
            >
              I've updated the secrets
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
