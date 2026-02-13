import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, AlertTriangle } from 'lucide-react';

export default function Cash() {
  const [list, setList] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ branch_id: '', from: '', to: '' });
  const [form, setForm] = useState({
    branch_id: '', entry_date: new Date().toISOString().slice(0, 10),
    opening_cash: 0, closing_cash: '', sales_cash: 0, expense_cash: 0, bank_deposit: 0, bank_withdrawal: 0, remarks: '',
  });

  const load = () => {
    const q = new URLSearchParams();
    if (filters.branch_id) q.set('branch_id', filters.branch_id);
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    api.get(`/cash?${q}`).then(setList).catch((e) => setErr(e.message));
    api.get('/cash/difference-alerts').then((d) => setAlerts(d.rows || [])).catch(() => {});
  };

  useEffect(() => { load(); }, [filters.branch_id, filters.from, filters.to]);
  useEffect(() => { api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({
      branch_id: branches[0]?.id || '', entry_date: new Date().toISOString().slice(0, 10),
      opening_cash: 0, closing_cash: '', sales_cash: 0, expense_cash: 0, bank_deposit: 0, bank_withdrawal: 0, remarks: '',
    });
    setModal('add');
  };

  const openEdit = (c) => {
    setForm({
      branch_id: c.branch_id, entry_date: c.entry_date,
      opening_cash: c.opening_cash ?? 0, closing_cash: c.closing_cash ?? '', sales_cash: c.sales_cash ?? 0, expense_cash: c.expense_cash ?? 0,
      bank_deposit: c.bank_deposit ?? 0, bank_withdrawal: c.bank_withdrawal ?? 0, remarks: c.remarks || '',
    });
    setModal('edit');
  };

  const expected = () =>
    (Number(form.opening_cash) || 0) + (Number(form.sales_cash) || 0) - (Number(form.expense_cash) || 0) -
    (Number(form.bank_deposit) || 0) + (Number(form.bank_withdrawal) || 0);

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const payload = { ...form, branch_id: form.branch_id || null, closing_cash: form.closing_cash || expected() };
      if (modal === 'add') await api.post('/cash', payload);
      else await api.patch(`/cash/${form.branch_id}/${form.entry_date}`, payload);
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cash Management</h1>
          <p className="text-slate-500 mt-1">Opening/closing cash, branch-wise, daily difference alerts</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Cash Entry</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      {alerts.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="font-medium text-amber-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Cash difference alerts</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left">Branch</th><th className="text-left">Date</th><th className="text-right">Difference</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={`${a.branch_id}-${a.entry_date}`}>
                    <td>{a.branch_name}</td><td>{a.entry_date}</td>
                    <td className="text-right font-mono">{fmt(a.difference)}</td>
                    <td className="text-right"><button onClick={() => openEdit(a)} className="btn-secondary text-xs">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <select className="input w-48" value={filters.branch_id} onChange={(e) => setFilters({ ...filters, branch_id: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className="input w-40" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" className="input w-40" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <button onClick={load} className="btn-secondary">Apply</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Opening</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Sales</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Expense</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Deposit</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Withdraw</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Closing</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Diff</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.map((c) => (
                <tr key={`${c.branch_id}-${c.entry_date}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{c.entry_date}</td>
                  <td className="px-4 py-3">{c.branch_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.opening_cash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.sales_cash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.expense_cash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.bank_deposit)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.bank_withdrawal)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.closing_cash)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(c.difference)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No cash entries.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Cash Entry' : 'Edit Cash Entry'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                <div><label className="label">Date *</label><input type="date" className="input" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} required readOnly={modal === 'edit'} /></div>
              </div>
              <div><label className="label">Opening Cash</label><input type="number" step="0.01" className="input" value={form.opening_cash} onChange={(e) => setForm({ ...form, opening_cash: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Sales Cash</label><input type="number" step="0.01" className="input" value={form.sales_cash} onChange={(e) => setForm({ ...form, sales_cash: e.target.value })} /></div>
                <div><label className="label">Expense Cash</label><input type="number" step="0.01" className="input" value={form.expense_cash} onChange={(e) => setForm({ ...form, expense_cash: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Bank Deposit</label><input type="number" step="0.01" className="input" value={form.bank_deposit} onChange={(e) => setForm({ ...form, bank_deposit: e.target.value })} /></div>
                <div><label className="label">Bank Withdrawal</label><input type="number" step="0.01" className="input" value={form.bank_withdrawal} onChange={(e) => setForm({ ...form, bank_withdrawal: e.target.value })} /></div>
              </div>
              <div><label className="label">Closing Cash (expected: {fmt(expected())})</label><input type="number" step="0.01" className="input" value={form.closing_cash} onChange={(e) => setForm({ ...form, closing_cash: e.target.value })} placeholder={fmt(expected())} /></div>
              <div><label className="label">Remarks</label><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
