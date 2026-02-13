import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { FileDown, BarChart3, DollarSign, Wallet, Truck } from 'lucide-react';

export default function Reports() {
  const [module, setModule] = useState('sales');
  const [type, setType] = useState('daily');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [branchId, setBranchId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [branches, setBranches] = useState([]);

  useEffect(() => { api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);

  const fetchReport = () => {
    setLoading(true);
    setErr('');
    setData(null);
    const run = () => setLoading(false);
    const append = (base, extra) => (extra ? `${base}${base.includes('?') ? '&' : '?'}${extra}` : base);
    if (module === 'sales') {
      if (type === 'daily') api.get(append(`/sales/reports/daily?date=${date}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'monthly') api.get(append(`/sales/reports/monthly?month=${month}&year=${year}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else api.get(append(`/sales/reports/date-range?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'purchases') {
      if (type === 'daily') api.get(append(`/purchases/reports/daily?date=${date}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'monthly') api.get(append(`/purchases/reports/monthly?month=${month}&year=${year}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'supplier') api.get(append(`/purchases/reports/supplier-wise`, from && to ? `from=${from}&to=${to}` : '')).then((d) => setData(Array.isArray(d) ? { rows: d, total: null } : d)).catch((e) => setErr(e.message)).finally(run);
      else api.get(append(`/purchases?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')).then((d) => setData({ rows: d, total: d.reduce((a, r) => a + (Number(r.total_amount) || 0), 0) })).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'expenses') {
      if (type === 'daily') api.get(append(`/expenses/reports/daily?date=${date}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'monthly') api.get(append(`/expenses/reports/monthly?month=${month}&year=${year}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'category') api.get(append(`/expenses/reports/category-wise`, [from && `from=${from}`, to && `to=${to}`, branchId && `branch_id=${branchId}`].filter(Boolean).join('&'))).then((d) => setData(Array.isArray(d) ? { rows: d, total: null } : d)).catch((e) => setErr(e.message)).finally(run);
      else api.get(append(`/expenses?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')).then((d) => setData({ rows: d, total: d.reduce((a, r) => a + (Number(r.amount) || 0), 0) })).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'inventory') {
      api.get(append(`/inventory/sales?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : ''))
        .then((d) => setData({ rows: d, total: d.reduce((a, r) => a + (Number(r.total) || 0), 0) }))
        .catch((e) => setErr(e.message))
        .finally(run);
    } else run();
  };

  const exportData = async (fmt) => {
    const q = new URLSearchParams({ type: fmt, module });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (branchId) q.set('branch_id', branchId);
    try {
      const res = await fetch(`/api/dashboard/export?${q}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${module}-${Date.now()}.${fmt}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const rows = data?.rows || [];
  const total = data?.total ?? (Array.isArray(data) ? data.reduce((a, r) => a + (Number(r.total) || Number(r.total_amount) || Number(r.amount) || 0), 0) : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
          <p className="text-slate-500 mt-1">Daily, monthly, date-range; PDF / Excel / CSV export</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportData('csv')} className="btn-secondary"><FileDown className="w-4 h-4" /> CSV</button>
          <button onClick={() => exportData('json')} className="btn-secondary"><FileDown className="w-4 h-4" /> JSON</button>
          <button onClick={() => exportData('xlsx')} className="btn-secondary"><FileDown className="w-4 h-4" /> Excel</button>
          <button onClick={() => exportData('pdf')} className="btn-secondary"><FileDown className="w-4 h-4" /> PDF</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Module</label>
            <select className="input w-40" value={module} onChange={(e) => {
              const next = e.target.value;
              setModule(next);
              setData(null);
              if (next === 'inventory') setType('range');
            }}>
              <option value="sales">Sales</option>
              <option value="purchases">Purchases</option>
              <option value="expenses">Expenses</option>
              <option value="inventory">Inventory</option>
            </select>
          </div>
          <div>
            <label className="label">Report type</label>
            <select className="input w-40" value={type} onChange={(e) => { setType(e.target.value); setData(null); }}>
              {module !== 'inventory' && <option value="daily">Daily</option>}
              {module !== 'inventory' && <option value="monthly">Monthly</option>}
              <option value="range">Date range</option>
              {module === 'purchases' && <option value="supplier">Supplier-wise</option>}
              {module === 'expenses' && <option value="category">Category-wise</option>}
            </select>
          </div>
          {type === 'daily' && <div><label className="label">Date</label><input type="date" className="input w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>}
          {type === 'monthly' && (
            <>
              <div><label className="label">Month</label><select className="input w-32" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={String(m).padStart(2, '0')}>{m}</option>)}</select></div>
              <div><label className="label">Year</label><input className="input w-24" value={year} onChange={(e) => setYear(e.target.value)} /></div>
            </>
          )}
          {(type === 'range' || type === 'supplier' || type === 'category') && (
            <>
              <div><label className="label">From</label><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="label">To</label><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <div>
            <label className="label">Branch</label>
            <select className="input w-40" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button onClick={fetchReport} className="btn-primary" disabled={loading}>{loading ? 'Loading…' : 'Run'}</button>
        </div>
      </div>

      {data && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Report result</h3>
            {typeof total === 'number' && <p className="text-lg font-bold text-primary-600">Total: {fmt(total)}</p>}
          </div>
          <div className="overflow-x-auto">
            {rows.length ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {Object.keys(rows[0]).filter((k) => !/^id$|^branch_id$|^category_id$|^supplier_id$/i.test(k)).map((k) => (
                      <th key={k} className="text-left px-4 py-3 font-medium text-slate-700 capitalize">{k.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {Object.entries(r).filter(([k]) => !/^id$|^branch_id$|^category_id$|^supplier_id$/i.test(k)).map(([k, v]) => (
                        <td key={k} className="px-4 py-3">{typeof v === 'number' ? fmt(v) : String(v ?? '–')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-8 text-center text-slate-500">No data.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
