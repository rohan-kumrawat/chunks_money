import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Clock, 
  ArrowRight, 
  CheckCircle2, 
  Smartphone, 
  Layers, 
  RefreshCw,
  CreditCard,
  QrCode,
  Lock,
  Building2,
  FileText,
  Settings,
  ChevronRight,
  ExternalLink,
  Sliders,
  Check
} from 'lucide-react';

interface Chunk {
  chunkId: string;
  chunkNumber: number;
  amount: number;
  status: 'QUEUED' | 'DELAYING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
  scheduledAt?: string;
  executedAt?: string;
  delayMs?: number;
  payoutReference?: string;
  idempotencyKey?: string;
  error?: string;
}

interface ActivePayment {
  collectionId: string;
  payerName: string;
  payeeUpi: string;
  totalAmount: number;
  totalChunks: number;
  completedChunks: number;
  disbursedAmount: number;
  remainingAmount: number;
  status: string;
  fraudEvaluation?: {
    score: number;
    riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
    triggeredRules: string[];
    recommendation: string;
  };
  chunks: Chunk[];
  upiIntent?: string;
  qrCodeUrl?: string;
}

export default function App() {
  // Payer Inputs
  const [payerName, setPayerName] = useState('Aarav Sharma');
  const [payerPhone, setPayerPhone] = useState('9876543210');
  const [payeeUpi, setPayeeUpi] = useState('rohan@oksbi');
  const [payeeName, setPayeeName] = useState('Rohan Verma');
  const [amount, setAmount] = useState<number>(5000);
  const [chunkLimit] = useState<number>(1999);

  // UI Tabs & Views
  const [activeTab, setActiveTab] = useState<'checkout' | 'tracker' | 'receiver'>('checkout');
  const [paymentMethod, setPaymentMethod] = useState<'qr' | 'upi_id' | 'cards'>('qr');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [gatewayProvider, setGatewayProvider] = useState<'MOCK' | 'RAZORPAY' | 'CASHFREE'>('MOCK');

  // Gateway Keys
  const [razorpayKey, setRazorpayKey] = useState('rzp_live_xxxxxxxxxxxx');
  const [cashfreeAppId, setCashfreeAppId] = useState('cf_app_xxxxxxxxxxxx');

  // App State
  const [isLoading, setIsLoading] = useState(false);
  const [activePayment, setActivePayment] = useState<ActivePayment | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [bankAlerts, setBankAlerts] = useState<Array<{ id: string; amount: number; time: string; chunkNumber: number; totalChunks: number; utr: string }>>([]);
  const [rateLimitTokens, setRateLimitTokens] = useState(10);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);

  // Quick Amount Presets
  const presets = [1999, 3500, 5000, 8500, 15000];

  // Calculated Preview Chunks
  const previewChunks = React.useMemo(() => {
    if (amount <= 0) return [];
    const chunks = [];
    let rem = Math.round(amount * 100);
    const limit = Math.round(chunkLimit * 100);
    let num = 1;
    while (rem > 0) {
      const current = Math.min(rem, limit);
      chunks.push({
        num,
        amount: current / 100,
        estDelay: num === 1 ? 'Immediate (0s)' : `+${((num - 1) * 2.8).toFixed(1)}s staggered`,
      });
      rem -= current;
      num++;
    }
    return chunks;
  }, [amount, chunkLimit]);

  // Connect to SSE for real-time events
  useEffect(() => {
    const eventSource = new EventSource('/api/payments/stream');

    eventSource.addEventListener('connected', () => setSseConnected(true));

    const handleChunkUpdate = () => {
      if (activePayment?.collectionId) {
        fetchStatus(activePayment.collectionId);
      }
    };

    eventSource.addEventListener('chunk_enqueued', handleChunkUpdate);
    eventSource.addEventListener('chunk_delaying', handleChunkUpdate);
    eventSource.addEventListener('chunk_processing', handleChunkUpdate);
    eventSource.addEventListener('chunk_success', (e: any) => {
      handleChunkUpdate();
      try {
        const job = JSON.parse(e.data);
        const utr = job.payoutReference ? job.payoutReference.replace('UTR-', '') : `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
        setBankAlerts((prev) => [
          {
            id: job.chunkId,
            amount: job.amount,
            chunkNumber: job.chunkNumber,
            totalChunks: job.totalChunks,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            utr,
          },
          ...prev,
        ]);
      } catch (err) {
        console.error(err);
      }
    });

    eventSource.onerror = () => setSseConnected(false);

    return () => eventSource.close();
  }, [activePayment?.collectionId]);

  // Refresh status
  const fetchStatus = async (id: string) => {
    try {
      const res = await fetch(`/api/payments/${id}/status`);
      if (res.ok) {
        const data = await res.json();
        setActivePayment(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Poll status when active
  useEffect(() => {
    if (!activePayment?.collectionId) return;
    if (activePayment.status === 'COMPLETED') return;

    const interval = setInterval(() => {
      fetchStatus(activePayment.collectionId);
      fetch(`/api/rate-limiter/${encodeURIComponent(payeeUpi)}`)
        .then((r) => r.json())
        .then((d) => setRateLimitTokens(d.tokens))
        .catch(() => {});
    }, 1000);

    return () => clearInterval(interval);
  }, [activePayment?.collectionId, activePayment?.status, payeeUpi]);

  // Pay Button Handler (Person A Checkout)
  const handlePay = async () => {
    if (amount <= 0 || !payeeUpi) return;
    setIsLoading(true);
    setBankAlerts([]);

    try {
      // 1. Initialize
      const initRes = await fetch('/api/payments/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerName,
          payerPhone: `+91${payerPhone}`,
          payeeUpi,
          payeeName,
          amount,
          chunkLimit,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to initialize payment');

      // 2. Confirm Collection & Trigger Chunks
      const confirmRes = await fetch(`/api/payments/${initData.collectionId}/confirm-collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gatewayPaymentId: `pay_${gatewayProvider.toLowerCase()}_${Date.now()}` }),
      });
      if (!confirmRes.ok) throw new Error('Payment collection confirmation failed');

      await fetchStatus(initData.collectionId);
      setActiveTab('tracker'); // Automatically switch to live tracker
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const progressPercent = activePayment && activePayment.totalAmount > 0
    ? Math.round((activePayment.disbursedAmount / activePayment.totalAmount) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      
      {/* 1. Header Navigation Bar (Light Fintech Style) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-slate-900 text-lg tracking-tight">Chunks Money</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  Max ₹1,999 / Chunk
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">Automated Sub-₹2,000 UPI Payout Portal</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            {/* Gateway Mode Indicator */}
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-md bg-slate-100 border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-slate-600 font-medium">Gateway:</span>
              <span className="font-semibold text-slate-900">{gatewayProvider} Payouts</span>
            </div>

            {/* Live SSE Stream status */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600">
              <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
              <span className="hidden md:inline">{sseConnected ? 'Live Connection' : 'Syncing'}</span>
            </div>

            {/* Settings Button */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium shadow-2xs transition-colors"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Sub-Header Navigation Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-8">
          <button
            onClick={() => setActiveTab('checkout')}
            className={`py-3.5 text-sm font-semibold border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === 'checkout'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>1. Customer Checkout (Person A)</span>
          </button>

          <button
            onClick={() => setActiveTab('tracker')}
            className={`py-3.5 text-sm font-semibold border-b-2 flex items-center space-x-2 transition-colors relative ${
              activeTab === 'tracker'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>2. Live Splitting Tracker</span>
            {activePayment && activePayment.status !== 'COMPLETED' && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('receiver')}
            className={`py-3.5 text-sm font-semibold border-b-2 flex items-center space-x-2 transition-colors ${
              activeTab === 'receiver'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>3. Receiver Passbook (Person B)</span>
            {bankAlerts.length > 0 && (
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {bankAlerts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 3. Main Workspace Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        
        {/* ======================================================== */}
        {/* TAB 1: CUSTOMER CHECKOUT (PERSON A VIEW)                 */}
        {/* ======================================================== */}
        {activeTab === 'checkout' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Col: Payment Details Form (7 Cols) */}
            <div className="lg:col-span-7 space-y-6">
              <div className="fintech-card rounded-2xl p-6 sm:p-7 shadow-xs">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Make a Payment</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Person A pays once. Transferred to Person B in safe chunks under ₹1,999.</p>
                  </div>
                  <div className="flex items-center space-x-1 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-100">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>NPCI Verified</span>
                  </div>
                </div>

                <div className="mt-6 space-y-5">
                  {/* Amount Field & Presets */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Transfer Amount (₹)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-2xl font-bold text-slate-400">₹</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
                        className="w-full pl-10 pr-4 py-2.5 text-2xl font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-mono shadow-2xs"
                        min={1}
                      />
                    </div>
                    {/* Amount Quick Presets */}
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {presets.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setAmount(p)}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-mono font-medium transition-all ${
                            amount === p
                              ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          ₹{p.toLocaleString('en-IN')}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Beneficiary Details (Person B) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Beneficiary UPI ID (Person B)
                      </label>
                      <input
                        type="text"
                        value={payeeUpi}
                        onChange={(e) => setPayeeUpi(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-mono"
                        placeholder="recipient@upi"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Beneficiary Name
                      </label>
                      <input
                        type="text"
                        value={payeeName}
                        onChange={(e) => setPayeeName(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                        placeholder="Rohan Verma"
                      />
                    </div>
                  </div>

                  {/* Payer Details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Payer Name (Person A)
                      </label>
                      <input
                        type="text"
                        value={payerName}
                        onChange={(e) => setPayerName(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                        Payer Mobile
                      </label>
                      <div className="flex">
                        <span className="inline-flex items-center px-3 text-xs font-semibold text-slate-500 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg">
                          +91
                        </span>
                        <input
                          type="tel"
                          value={payerPhone}
                          onChange={(e) => setPayerPhone(e.target.value)}
                          className="w-full px-3.5 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Payment Method Selector */}
                  <div className="pt-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                      Select Payment Method
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('qr')}
                        className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 transition-all ${
                          paymentMethod === 'qr'
                            ? 'bg-blue-50/70 border-blue-600 text-blue-700 shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <QrCode className="w-5 h-5" />
                        <span className="text-xs font-semibold">UPI QR Code</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod('upi_id')}
                        className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 transition-all ${
                          paymentMethod === 'upi_id'
                            ? 'bg-blue-50/70 border-blue-600 text-blue-700 shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Smartphone className="w-5 h-5" />
                        <span className="text-xs font-semibold">UPI Apps</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cards')}
                        className={`p-3 rounded-xl border flex flex-col items-center justify-center space-y-1 transition-all ${
                          paymentMethod === 'cards'
                            ? 'bg-blue-50/70 border-blue-600 text-blue-700 shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Building2 className="w-5 h-5" />
                        <span className="text-xs font-semibold">Netbanking</span>
                      </button>
                    </div>
                  </div>

                  {/* Payment Method Panel (QR Code preview) */}
                  {paymentMethod === 'qr' && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
                      <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=upi%3A%2F%2Fpay%3Fpa%3Dchunks.merchant%40icici%26pn%3DChunksMoney%26am%3D${amount}%26cu%3DINR`}
                          alt="UPI Payment QR Code"
                          className="w-32 h-32"
                        />
                      </div>
                      <div className="space-y-1.5 text-center sm:text-left">
                        <span className="text-xs font-bold text-slate-800 flex items-center justify-center sm:justify-start gap-1">
                          <QrCode className="w-4 h-4 text-blue-600" />
                          Scan with Any UPI App
                        </span>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Scan with PhonePe, Google Pay, Paytm, or BHIM. Person A is charged once for ₹{amount.toLocaleString('en-IN')}.
                        </p>
                        <div className="flex items-center justify-center sm:justify-start gap-2 pt-1">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">GPay</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">PhonePe</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">Paytm</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={isLoading || amount <= 0}
                    className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-sm shadow-blue-500/20 transition-all disabled:opacity-50 flex items-center justify-center space-x-2 text-sm cursor-pointer"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>Pay ₹{amount.toLocaleString('en-IN')} (One-Click Collection)</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Trust & Compliance Footer Badges */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 px-2">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  256-Bit SSL Encryption
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  PCI-DSS Level 1 Compliant
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                  Bank Velocity Guard Enabled
                </span>
              </div>
            </div>

            {/* Right Col: Transparent Breakdown & Schedule (5 Cols) */}
            <div className="lg:col-span-5 space-y-6">
              <div className="fintech-card rounded-2xl p-6 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
                  Automated Chunk Schedule
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  Transfers are split into sub-₹2,000 chunks to ensure 0% failure and avoid bank anti-spam locks.
                </p>

                <div className="space-y-2.5">
                  {previewChunks.map((chunk) => (
                    <div
                      key={chunk.num}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 font-bold font-mono text-xs flex items-center justify-center">
                          #{chunk.num}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800 text-sm font-mono">
                            ₹{chunk.amount.toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Transfer {chunk.num} to {payeeUpi}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                          {chunk.estDelay}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary Totals */}
                <div className="mt-5 pt-4 border-t border-slate-100 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Lump Sum Paid by Person A:</span>
                    <span className="font-mono font-semibold text-slate-900">₹{amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Credited to Person B:</span>
                    <span className="font-mono font-semibold text-emerald-600">₹{amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Payout Batches:</span>
                    <span className="font-semibold text-slate-800">{previewChunks.length} automated chunks</span>
                  </div>
                </div>

                {/* Bank Velocity Protection Notice */}
                <div className="mt-5 p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 text-xs text-blue-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5 text-blue-800">
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    Why Split at ₹1,999?
                  </div>
                  <p className="text-[11px] text-blue-700 leading-relaxed">
                    Under Indian banking regulations, sub-₹2,000 transfers receive instant UPI processing without additional 2FA friction or merchant limits. Delays of 2.5s to 8.5s ensure the beneficiary bank does not flag repeated deposits.
                  </p>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: LIVE SPLITTING TRACKER & BANK UTR LOGS            */}
        {/* ======================================================== */}
        {activeTab === 'tracker' && (
          <div className="space-y-6">
            {activePayment ? (
              <>
                {/* Status Hero Card */}
                <div className="fintech-card rounded-2xl p-6 shadow-xs">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-lg font-bold text-slate-900">Live Payout Orchestration</h2>
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          activePayment.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                        }`}>
                          {activePayment.status === 'COMPLETED' ? 'Settlement Completed' : 'Processing Chunks'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 font-mono">Session ID: {activePayment.collectionId}</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setReceiptModalOpen(true)}
                        className="px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center space-x-1.5 shadow-2xs"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>View Official Receipt</span>
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar & Amounts */}
                  <div className="mt-6 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-600">Disbursed to {activePayment.payeeUpi}:</span>
                      <span className="font-mono text-slate-900">
                        ₹{activePayment.disbursedAmount.toFixed(2)} / ₹{activePayment.totalAmount.toFixed(2)} ({progressPercent}%)
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                      <div
                        className="h-full bg-blue-600 transition-all duration-500 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Key Metrics Grid */}
                  <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                      <span className="text-[11px] text-slate-500 uppercase font-medium">Total Amount</span>
                      <p className="text-base font-bold font-mono text-slate-900 mt-0.5">₹{activePayment.totalAmount.toFixed(2)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                      <span className="text-[11px] text-slate-500 uppercase font-medium">Disbursed</span>
                      <p className="text-base font-bold font-mono text-emerald-600 mt-0.5">₹{activePayment.disbursedAmount.toFixed(2)}</p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                      <span className="text-[11px] text-slate-500 uppercase font-medium">Completed Chunks</span>
                      <p className="text-base font-bold font-mono text-blue-600 mt-0.5">
                        {activePayment.completedChunks} of {activePayment.totalChunks}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                      <span className="text-[11px] text-slate-500 uppercase font-medium">Fraud Risk Tier</span>
                      <p className="text-base font-bold font-mono text-emerald-600 mt-0.5">
                        {activePayment.fraudEvaluation?.riskTier || 'LOW'} (0/100)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Individual Chunks Execution Table */}
                <div className="fintech-card rounded-2xl p-6 shadow-xs">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
                    Chunk Execution Audit Log
                  </h3>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold">
                          <th className="pb-3 pl-2">Chunk #</th>
                          <th className="pb-3">Amount</th>
                          <th className="pb-3">Beneficiary VPA</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3">Bank Reference (UTR)</th>
                          <th className="pb-3">Stagger Delay</th>
                          <th className="pb-3 pr-2 text-right">Idempotency Key</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activePayment.chunks.map((chunk) => (
                          <tr key={chunk.chunkId} className="hover:bg-slate-50/50">
                            <td className="py-3.5 pl-2 font-mono font-bold text-slate-700">
                              Chunk #{chunk.chunkNumber}
                            </td>
                            <td className="py-3.5 font-mono font-bold text-slate-900">
                              ₹{chunk.amount.toFixed(2)}
                            </td>
                            <td className="py-3.5 font-mono text-slate-600">
                              {activePayment.payeeUpi}
                            </td>
                            <td className="py-3.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                                chunk.status === 'SUCCESS'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : chunk.status === 'PROCESSING'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                                  : chunk.status === 'DELAYING'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {chunk.status}
                              </span>
                            </td>
                            <td className="py-3.5 font-mono text-slate-700 font-medium">
                              {chunk.payoutReference || (
                                <span className="text-slate-400 italic">Pending execution...</span>
                              )}
                            </td>
                            <td className="py-3.5 text-slate-500 font-mono">
                              {(chunk.delayMs || 0) > 0 ? `${(chunk.delayMs! / 1000).toFixed(1)}s` : 'Instant (0s)'}
                            </td>
                            <td className="py-3.5 pr-2 font-mono text-[10px] text-slate-400 text-right truncate max-w-[140px]">
                              {chunk.idempotencyKey}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="fintech-card rounded-2xl p-12 text-center shadow-xs">
                <Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-bold text-slate-800">No Active Payout Session</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-5">
                  Initiate a payment from the Checkout tab to see live split transfers, UTR generation, and bank delays in real-time.
                </p>
                <button
                  onClick={() => setActiveTab('checkout')}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs"
                >
                  Go to Checkout Form
                </button>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: RECEIVER PASSBOOK & BANK NOTIFICATIONS (PERSON B) */}
        {/* ======================================================== */}
        {activeTab === 'receiver' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="fintech-card rounded-2xl p-6 shadow-xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Beneficiary Passbook & Bank SMS Feed</h2>
                  <p className="text-xs text-slate-500 font-mono">Account: {payeeUpi} ({payeeName})</p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {bankAlerts.length} Credits Received
                </span>
              </div>

              {/* Bank SMS Alerts Simulator */}
              <div className="mt-6 space-y-3">
                {bankAlerts.length > 0 ? (
                  bankAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs hover:border-blue-300 transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Check className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-800">
                              Official Bank UPI Credit Alert
                            </span>
                            <span className="text-[10px] text-slate-500 ml-2 font-mono">{alert.time}</span>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-sm text-emerald-600">
                          + ₹{alert.amount.toFixed(2)}
                        </span>
                      </div>

                      {/* Realistic Bank SMS text format */}
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 font-mono text-[11px] text-slate-700 leading-relaxed">
                        Dear SBI Customer, your A/C ending 4821 is credited by Rs. {alert.amount.toFixed(2)} on {new Date().toLocaleDateString('en-GB')} via UPI from {payerName.toUpperCase()} (Ref No: {alert.utr}). Transfer {alert.chunkNumber} of {alert.totalChunks}.
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-10 text-center text-slate-400">
                    <Smartphone className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs">Waiting for incoming chunk transfers...</p>
                    <p className="text-[11px] text-slate-400 mt-1">Once Person A initiates payment, credits will appear here with official bank UTR numbers.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* 4. Settings Drawer Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="fintech-card rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-base">Gateway & Production Setup</h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1.5">Active Payment Gateway</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['MOCK', 'RAZORPAY', 'CASHFREE'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGatewayProvider(g)}
                      className={`p-2.5 rounded-lg border font-semibold transition-all ${
                        gatewayProvider === g
                          ? 'bg-blue-50 border-blue-600 text-blue-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {gatewayProvider === 'RAZORPAY' && (
                <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-semibold text-slate-800">RazorpayX Production Credentials</span>
                  <div>
                    <label className="text-slate-500 block mb-1">Key ID</label>
                    <input
                      type="text"
                      value={razorpayKey}
                      onChange={(e) => setRazorpayKey(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-slate-800"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Collection via Razorpay Standard Checkout; Payouts via RazorpayX Payouts API.
                  </p>
                </div>
              )}

              {gatewayProvider === 'CASHFREE' && (
                <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-semibold text-slate-800">Cashfree Production Credentials</span>
                  <div>
                    <label className="text-slate-500 block mb-1">App ID / Client ID</label>
                    <input
                      type="text"
                      value={cashfreeAppId}
                      onChange={(e) => setCashfreeAppId(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-slate-800"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Cashfree Payouts v1.2 batch API for instant automated sub-₹2k UPI disbursals.
                  </p>
                </div>
              )}

              {gatewayProvider === 'MOCK' && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-blue-800 text-[11px] leading-relaxed">
                  Mock Sandbox generates realistic 12-digit Indian Bank UTR references and simulates 150ms network latency without consuming live bank funds.
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Printable Receipt Modal */}
      {receiptModalOpen && activePayment && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="fintech-card rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="text-center pb-4 border-b border-slate-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center mb-2">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-900 text-base">Payment Receipt</h3>
              <p className="text-xs text-slate-500">Official Settlement Confirmation</p>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Total Amount:</span>
                <span className="font-bold text-slate-900">₹{activePayment.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Payer (Person A):</span>
                <span className="text-slate-900">{activePayment.payerName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Beneficiary (Person B):</span>
                <span className="text-slate-900">{activePayment.payeeUpi}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Split Batches:</span>
                <span className="text-slate-900">{activePayment.totalChunks} chunks</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Settlement Status:</span>
                <span className="font-bold text-emerald-600">{activePayment.status}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold"
              >
                Print Receipt
              </button>
              <button
                onClick={() => setReceiptModalOpen(false)}
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
