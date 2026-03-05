import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Landmark, Receipt, Truck, DollarSign, WalletCards, PiggyBank } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export default function Dashboard() {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard').then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;
  if (err) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>;
  if (!data) return null;

  const { widgets, branchComparison, bankAccounts, date } = data;

  const baseCards = [
    { labelKey: 'dashboard.card.salesToday', defaultLabel: 'Sales Today', value: widgets.salesToday, icon: DollarSign, color: 'bg-primary-500' },
    { labelKey: 'dashboard.card.salesTodayCash', defaultLabel: 'Cash Sales Today', value: widgets.salesTodayCash, icon: WalletCards, color: 'bg-emerald-500' },
    { labelKey: 'dashboard.card.salesTodayBank', defaultLabel: 'Bank Sales Today', value: widgets.salesTodayBank, icon: Landmark, color: 'bg-blue-500' },
    { labelKey: 'dashboard.card.salesTodayCredit', defaultLabel: 'Sales Today on Credit', value: widgets.salesTodayCredit, icon: Receipt, color: 'bg-amber-500' },
    { labelKey: 'dashboard.card.salesOnCredit', defaultLabel: 'Sales on Credit (Receivable)', value: widgets.salesOnCredit, icon: Receipt, color: 'bg-violet-500' },
    { labelKey: 'dashboard.card.receivableRecovered', defaultLabel: 'Receivable Recoveries (Total)', value: widgets.receivableRecovered, icon: Receipt, color: 'bg-emerald-700' },
    { labelKey: 'dashboard.card.salesMonth', defaultLabel: 'Sales (Month)', value: widgets.salesMonth, icon: TrendingUp, color: 'bg-accent-500' },
    { labelKey: 'dashboard.card.salesMonthCash', defaultLabel: 'Cash Sales (Month)', value: widgets.salesMonthCash, icon: WalletCards, color: 'bg-emerald-500' },
    { labelKey: 'dashboard.card.salesMonthBank', defaultLabel: 'Bank Sales (Month)', value: widgets.salesMonthBank, icon: Landmark, color: 'bg-blue-500' },
    { labelKey: 'dashboard.card.netProfitMonth', defaultLabel: 'Net Profit (Month)', value: widgets.netProfit, icon: TrendingUp, color: 'bg-emerald-600' },
    { labelKey: 'dashboard.card.cashInHand', defaultLabel: 'Cash in Hand', value: widgets.cashInHand, icon: PiggyBank, color: 'bg-lime-500' },
    { labelKey: 'dashboard.card.bankBalance', defaultLabel: 'Bank Balance', value: widgets.bankBalance, icon: Landmark, color: 'bg-blue-600' },
    { labelKey: 'dashboard.card.payables', defaultLabel: 'Payables', value: widgets.payables, icon: Truck, color: 'bg-rose-500' },
    { labelKey: 'dashboard.card.rentBillsPayable', defaultLabel: 'Total Rent & Bills Payable', value: widgets.rentBillsPayable, icon: Receipt, color: 'bg-orange-500' },
    { labelKey: 'dashboard.card.salariesPayable', defaultLabel: 'Total Salaries Payable', value: widgets.salariesPayable, icon: DollarSign, color: 'bg-fuchsia-600' },
    { labelKey: 'dashboard.card.totalPaidAll', defaultLabel: 'Total Paid (All)', value: widgets.totalPaid, icon: DollarSign, color: 'bg-emerald-700' },
  ];

  const bankCards = (Array.isArray(bankAccounts) ? bankAccounts : []).map((b) => ({
    label: b.name,
    subLabel: b.account_number || '–',
    value: b.balance,
    icon: Landmark,
    color: 'bg-blue-500',
  }));

  const cards = [...baseCards, ...bankCards];

  const branchData = (branchComparison || []).map((b) => ({ name: b.name || 'N/A', total: parseFloat(b.total) || 0 }));

  const fmt = (n) => {
    const x = Number(n);
    if (isNaN(x)) return '0';
    return x.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('page.dashboard.title')}</h1>
        <p className="text-slate-500 mt-1">Overview • {date}</p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map(({ label, labelKey, defaultLabel, subLabel, value, icon: Icon, color }) => (
          <div key={labelKey || label || defaultLabel} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  {labelKey ? t(labelKey) : (label || defaultLabel)}
                </p>
                {subLabel && <p className="mt-0.5 text-xs text-slate-400">{subLabel}</p>}
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
      </div>
    </div>
  );
}
