import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Wallet, Landmark, Receipt, Truck, DollarSign, Building2 } from 'lucide-react';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard').then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;
  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>;
  if (!data) return null;

  const { widgets, branchComparison, expenseHeatmap, date } = data;

  const cards = [
    { label: 'Sales Today', value: widgets.salesToday, icon: DollarSign, color: 'bg-primary-500' },
    { label: 'Sales (Month)', value: widgets.salesMonth, icon: TrendingUp, color: 'bg-accent-500' },
    { label: 'Net Profit (Month)', value: widgets.netProfit, icon: TrendingUp, color: 'bg-emerald-500' },
    { label: 'Cash in Hand', value: widgets.cashInHand, icon: Wallet, color: 'bg-amber-500' },
    { label: 'Bank Balance', value: widgets.bankBalance, icon: Landmark, color: 'bg-blue-500' },
    { label: 'Receivables', value: widgets.receivables, icon: Receipt, color: 'bg-violet-500' },
    { label: 'Payables', value: widgets.payables, icon: Truck, color: 'bg-rose-500' },
  ];

  const branchData = (branchComparison || []).map((b) => ({ name: b.name || 'N/A', total: parseFloat(b.total) || 0 }));
  const expenseData = (expenseHeatmap || []).map((b) => ({ name: b.name || 'Other', value: parseFloat(b.total) || 0 }));

  const fmt = (n) => {
    const x = Number(n);
    if (isNaN(x)) return '0';
    return x.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Overview • {date}</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{fmt(value)}</p>
              </div>
              <div className={`rounded-lg p-2 ${color} text-white`}><Icon className="w-5 h-5" /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Branch Comparison (Month)</h2>
          {branchData.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="total" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-slate-500 py-8 text-center">No branch data</p>
          )}
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Expenses by Category (Month)</h2>
          {expenseData.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => e.name}>
                    {expenseData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-slate-500 py-8 text-center">No expense data</p>
          )}
        </div>
      </div>
    </div>
  );
}
