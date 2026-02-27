import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { CreditCard, FileText, Banknote, Landmark, WalletCards } from 'lucide-react';

const CATEGORIES = [
  { value: 'rent_bill', label: 'Rent & Bills', icon: FileText, kind: 'give' },
  { value: 'salary', label: 'Salaries', icon: Banknote, kind: 'give' },
];

const FILTER_TYPES = [
  { value: '', label: 'All types' },
  { value: 'rent_bill', label: 'Rent & Bills' },
  { value: 'salary', label: 'Salary' },
];

export default function Payments() {
  const [options, setOptions] = useState({ rent_bills: [], salaries: [], banks: [] });
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
  const [filterType, setFilterType] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [branches, setBranches] = useState([]);

  const loadOptions = () => api.get('/payments/options').then(setOptions).catch((e) => setErr(e.message));
  const loadRecent = () => {
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('type', filterType);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    return api.get(`/payments?${params}`).then(setRecentPayments).catch(() => {});
  };

  useEffect(() => {
    loadOptions().finally(() => setLoading(false));
    api.get('/branches?active=1').then(setBranches).catch(() => {});
  }, []);
  useEffect(() => { loadRecent(); }, [filterType, filterFrom, filterTo]);

  useEffect(() => {
    setReferenceId('');
    setAmount('');
  }, [category]);

  const subOptions = () => {
    if (category === 'rent_bill') return options.rent_bills || [];
    if (category === 'salary') return options.salaries || [];
    return [];
  };

  const selectedSub = subOptions().find((s) => String(s.id) === String(referenceId));
  const maxAmount =
    category === 'rent_bill' && selectedSub
      ? (Number(selectedSub.balance) || 0)
      : category === 'salary' && selectedSub
      ? (Number(selectedSub.remaining_amount ?? selectedSub.net_salary) || 0)
      : null;

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
        <p className="text-slate-500 mt-1">Record any payment (send) or receipt (receive from customer). Pay suppliers, rent & bills, salaries; receive from customers. Balance shown where applicable.</p>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-6 max-w-4xl">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5" /> Record payment
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Type</label>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Type</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.filter((c) => c.kind === 'give').map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setCategory(c.value)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                          category === c.value
                            ? 'border-primary-600 bg-primary-50 text-primary-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <c.icon className="w-4 h-4" /> {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {category && (
                <>
                  {category && (
                  <div>
                    <label className="label">
                        {category === 'rent_bill'
                        ? 'Rent / Bill'
                        : 'Salary record'}
                    </label>
                    <select
                      className="input w-full"
                      value={referenceId}
                      onChange={(e) => {
                        setReferenceId(e.target.value);
                        const s = subOptions().find((x) => String(x.id) === e.target.value);
                        if (category === 'rent_bill' && s) setAmount(String(s.balance ?? ''));
                        if (category === 'salary' && s) setAmount(String((s.remaining_amount ?? s.net_salary) ?? ''));
                      }}
                      required
                    >
                      <option value="">Select…</option>
                      {category === 'rent_bill' &&
                        (options.rent_bills || []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title} — Balance: {fmt(r.balance)}
                          </option>
                        ))}
                      {category === 'salary' &&
                        (options.salaries || []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.staff_name} — {s.month_year} — {fmt(s.net_salary)}
                          </option>
                        ))}
                    </select>
                  </div>
                  </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        className="input w-full"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        placeholder={
                          maxAmount != null
                            ? `Max ${maxAmount}`
                            : category === 'supplier' && supplierBalance != null
                            ? `Max ${fmt(supplierBalance)}`
                            : ''
                        }
                      />
                    </div>
                    <div>
                      <label className="label">Payment date *</label>
                      <input
                        type="date"
                        className="input w-full"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Payment method (deduct from)</label>
                      <select
                        className="input w-full"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                      >
                        <option value="cash">Cash</option>
                        {(options.banks || []).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} {b.account_number ? `(${b.account_number})` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">
                        Select bank to deduct from; cash does not affect bank balance.
                      </p>
                    </div>
                    <div>
                      <label className="label">Remarks</label>
                      <input
                        className="input w-full"
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button type="submit" className="btn-primary" disabled={submitting}>
                      {submitting ? 'Processing…' : 'Pay'}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>

          <div className="w-full lg:w-64 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-primary-600" /> Summary
            </h3>
            {category === 'rent_bill' && selectedSub && (
              <div className="space-y-1 text-sm">
                <p className="text-slate-700 font-medium">{selectedSub.title}</p>
                <p className="text-slate-500">
                  Balance:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.balance)}
                  </span>
                </p>
              </div>
            )}
            {category === 'salary' && selectedSub && (
              <div className="space-y-1 text-sm">
                <p className="text-slate-700 font-medium">
                  {selectedSub.staff_name} — {selectedSub.month_year}
                </p>
                <p className="text-slate-500">
                  Base:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.base_salary)}
                  </span>
                  {' · '}
                  Commission:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.commission)}
                  </span>
                </p>
                <p className="text-slate-500">
                  Advances:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.advances)}
                  </span>
                  {' · '}
                  Deductions:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.deductions)}
                  </span>
                </p>
                <p className="text-slate-500">
                  Net salary:{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.net_salary)}
                  </span>
                </p>
                <p className="text-slate-500">
                  Remaining (this salary):{' '}
                  <span className="font-semibold text-slate-900">
                    {fmt(selectedSub.remaining_amount ?? selectedSub.net_salary)}
                  </span>
                </p>
              </div>
            )}
            {!category && (
              <p className="text-xs text-slate-500">
                Select a type (send or receive); balance is shown here when applicable.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 justify-between">
          <h3 className="font-semibold text-slate-900">Payments &amp; receipts</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input text-sm w-auto min-w-[140px]"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              {FILTER_TYPES.map((f) => (
                <option key={f.value || 'all'} value={f.value}>{f.label}</option>
              ))}
            </select>
            <input
              type="date"
              className="input text-sm w-auto"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              placeholder="From"
            />
            <input
              type="date"
              className="input text-sm w-auto"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              placeholder="To"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Reference</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Method</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(recentPayments || []).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{p.payment_date}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.reference_type === 'receivable' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'
                    }`}>
                      {p.reference_type === 'receivable' ? 'Receive' : (p.reference_type || p.type || '').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{p.reference_label || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(p.amount)}</td>
                  <td className="px-4 py-3">{p.mode === 'bank' && p.bank_name ? p.bank_name : 'Cash'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.remarks || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!recentPayments || !recentPayments.length) && <p className="p-8 text-center text-slate-500">No payments match the filters.</p>}
      </div>
    </div>
  );
}
