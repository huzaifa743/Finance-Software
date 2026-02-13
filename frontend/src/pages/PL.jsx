import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function PL() {
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 7) + '-01');
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [branch, setBranch] = useState(null);
  const [consolidated, setConsolidated] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [yearly, setYearly] = useState(null);
  const [branches, setBranches] = useState([]);
  const [view, setView] = useState('range');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);

  const fetchBranch = () => {
    if (!branchId || !from || !to) return;
    setLoading(true);
    setErr('');
    api.get(`/pl/branch/${branchId}?from=${from}&to=${to}`)
      .then(setBranch)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  const fetchConsolidated = () => {
    if (!from || !to) return;
    setLoading(true);
    setErr('');
    api.get(`/pl/consolidated?from=${from}&to=${to}`)
      .then(setConsolidated)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  const fetchMonthly = () => {
    const y = to ? to.slice(0, 4) : new Date().getFullYear();
    setLoading(true);
    setErr('');
    api.get(`/pl/monthly-comparison?year=${y}`)
      .then((d) => setMonthly(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  const fetchYearly = () => {
    const y = to ? to.slice(0, 4) : new Date().getFullYear();
    setLoading(true);
    setErr('');
    api.get(`/pl/yearly-summary?year=${y}`)
      .then(setYearly)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Profit & Loss</h1>
        <p className="text-slate-500 mt-1">Branch-wise, consolidated, gross/net profit, expense ratio</p>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">From</label>
            <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Branch (optional)</label>
            <select className="input w-48" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Consolidated</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button onClick={branchId ? fetchBranch : fetchConsolidated} className="btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          <button onClick={fetchMonthly} className="btn-secondary" disabled={loading}>Monthly comparison</button>
          <button onClick={fetchYearly} className="btn-secondary" disabled={loading}>Yearly summary</button>
        </div>
      </div>

      {branch && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Branch P&L — {from} to {to}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Sales</p><p className="text-xl font-bold">{fmt(branch.grossSales)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Cost of Goods</p><p className="text-xl font-bold">{fmt(branch.costOfGoods)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Profit</p><p className="text-xl font-bold text-green-600">{fmt(branch.grossProfit)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Expenses</p><p className="text-xl font-bold">{fmt(branch.totalExpenses)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Net Profit</p><p className="text-xl font-bold text-primary-600">{fmt(branch.netProfit)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Expense Ratio %</p><p className="text-xl font-bold">{branch.expenseRatio}%</p></div>
          </div>
        </div>
      )}

      {consolidated && !branchId && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Consolidated P&L — {from} to {to}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Sales</p><p className="text-xl font-bold">{fmt(consolidated.grossSales)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Cost of Goods</p><p className="text-xl font-bold">{fmt(consolidated.costOfGoods)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Profit</p><p className="text-xl font-bold text-green-600">{fmt(consolidated.grossProfit)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Expenses</p><p className="text-xl font-bold">{fmt(consolidated.totalExpenses)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Net Profit</p><p className="text-xl font-bold text-primary-600">{fmt(consolidated.netProfit)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Expense Ratio %</p><p className="text-xl font-bold">{consolidated.expenseRatio}%</p></div>
          </div>
        </div>
      )}

      {yearly && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Yearly Summary — {yearly.year}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Sales</p><p className="text-xl font-bold">{fmt(yearly.grossSales)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Cost of Goods</p><p className="text-xl font-bold">{fmt(yearly.costOfGoods)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Gross Profit</p><p className="text-xl font-bold text-green-600">{fmt(yearly.grossProfit)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Expenses</p><p className="text-xl font-bold">{fmt(yearly.totalExpenses)}</p></div>
            <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Net Profit</p><p className="text-xl font-bold text-primary-600">{fmt(yearly.netProfit)}</p></div>
          </div>
        </div>
      )}

      {monthly?.months?.length > 0 && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Monthly Profit Comparison — {monthly.year}</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly.months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Bar dataKey="netProfit" name="Net Profit" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
