import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { CreditCard, Building2, FileText, Banknote } from 'lucide-react';

const CATEGORIES = [
  { value: 'supplier', label: 'Supplier', icon: Building2 },
  { value: 'rent_bill', label: 'Rent & Bills', icon: FileText },
  { value: 'salary', label: 'Salaries', icon: Banknote },
];

export default function Payments() {
  const [options, setOptions] = useState({ suppliers: [], rent_bills: [], salaries: [], banks: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [category, setCategory] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recentPayments, setRecentPayments] = useState([]);

  const loadOptions = () => api.get('/payments/options').then(setOptions).catch((e) => setErr(e.message));
  const loadRecent = () => api.get('/payments?limit=20').then(setRecentPayments).catch(() => {});

  useEffect(() => { loadOptions().finally(() => setLoading(false)); }, []);
  useEffect(() => { loadRecent(); }, []);

  useEffect(() => {
    setReferenceId('');
    setAmount('');
  }, [category]);

  const subOptions = () => {
    if (category === 'supplier') return options.suppliers || [];
    if (category === 'rent_bill') return options.rent_bills || [];
    if (category === 'salary') return options.salaries || [];
    return [];
  };

  const selectedSub = subOptions().find((s) => String(s.id) === String(referenceId));
  const maxAmount = category === 'rent_bill' && selectedSub ? (Number(selectedSub.balance) || 0) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!category || !referenceId) {
      setErr('Please select category and an item to pay.');
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setErr('Enter a valid amount.');
      return;
    }
    if (maxAmount != null && amt > maxAmount) {
      setErr(`Amount cannot exceed balance (${maxAmount}).`);
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/payments', {
        category,
        reference_id: referenceId,
        amount: amt,
        payment_date: paymentDate,
        payment_method: paymentMethod === 'cash' ? 'cash' : paymentMethod,
        remarks: remarks || undefined,
      });
      setAmount('');
      setRemarks('');
      loadOptions();
      loadRecent();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
        <p className="text-slate-500 mt-1">Pay suppliers, rent & bills, and salaries. Select payment method to deduct from.</p>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5" /> Make Payment</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Payment type</label>
            <div className="flex flex-wrap gap-3 mt-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${category === c.value ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  <c.icon className="w-4 h-4" /> {c.label}
                </button>
              ))}
            </div>
          </div>

          {category && (
            <>
              <div>
                <label className="label">{category === 'supplier' ? 'Supplier' : category === 'rent_bill' ? 'Rent / Bill' : 'Salary record'}</label>
                <select className="input w-full" value={referenceId} onChange={(e) => { setReferenceId(e.target.value); const s = subOptions().find(x => String(x.id) === e.target.value); if (category === 'rent_bill' && s) setAmount(String(s.balance ?? '')); if (category === 'salary' && s) setAmount(String(s.net_salary ?? '')); }} required>
                  <option value="">Select…</option>
                  {category === 'supplier' && (options.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {category === 'rent_bill' && (options.rent_bills || []).map((r) => <option key={r.id} value={r.id}>{r.title} — Balance: {fmt(r.balance)}</option>)}
                  {category === 'salary' && (options.salaries || []).map((s) => <option key={s.id} value={s.id}>{s.staff_name} — {s.month_year} — {fmt(s.net_salary)}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Amount *</label>
                  <input type="number" step="0.01" className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder={maxAmount != null ? `Max ${maxAmount}` : ''} />
                </div>
                <div>
                  <label className="label">Payment date *</label>
                  <input type="date" className="input w-full" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
                </div>
              </div>

              <div>
                <label className="label">Payment method (deduct from)</label>
                <select className="input w-full" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  {(options.banks || []).map((b) => <option key={b.id} value={b.id}>{b.name} {b.account_number ? `(${b.account_number})` : ''}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">Select bank to deduct from; cash does not affect bank balance.</p>
              </div>

              <div>
                <label className="label">Remarks</label>
                <input className="input w-full" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
              </div>

              <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Processing…' : 'Pay'}</button>
            </>
          )}
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">Recent payments</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Type</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Method</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(recentPayments || []).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{p.payment_date}</td>
                  <td className="px-4 py-3 capitalize">{p.reference_type?.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(p.amount)}</td>
                  <td className="px-4 py-3">{p.mode === 'bank' && p.bank_name ? p.bank_name : 'Cash'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.remarks || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!recentPayments || !recentPayments.length) && <p className="p-8 text-center text-slate-500">No payments yet.</p>}
      </div>
    </div>
  );
}
