import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, AlertTriangle, Paperclip } from 'lucide-react';

export default function Purchases() {
  const [list, setList] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [reminders, setReminders] = useState([]);
  const [modal, setModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [filters, setFilters] = useState({ supplier_id: '', branch_id: '', from: '', to: '' });
  const [form, setForm] = useState({ supplier_id: '', branch_id: '', invoice_no: '', purchase_date: '', due_date: '', total_amount: '', paid_amount: 0, remarks: '' });
  const [payForm, setPayForm] = useState({ purchase_id: '', supplier_id: '', amount: '', payment_date: '', mode: 'cash' });
  const [attachmentsModal, setAttachmentsModal] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState('');

  const load = () => {
    const q = new URLSearchParams();
    if (filters.supplier_id) q.set('supplier_id', filters.supplier_id);
    if (filters.branch_id) q.set('branch_id', filters.branch_id);
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    api.get(`/purchases?${q}`).then(setList).catch((e) => setErr(e.message));
  };

  useEffect(() => { load(); }, [filters.supplier_id, filters.branch_id, filters.from, filters.to]);
  const loadSuppliers = () => api.get('/purchases/suppliers').then(setSuppliers).catch(() => {});
  const loadReminders = () => api.get('/purchases/due-reminders?days=7').then((d) => setReminders(d.rows || [])).catch(() => {});

  useEffect(() => {
    loadSuppliers();
    api.get('/branches?active=1').then(setBranches).catch(() => {});
    loadReminders();
  }, []);
  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ supplier_id: suppliers[0]?.id || '', branch_id: '', invoice_no: '', purchase_date: new Date().toISOString().slice(0, 10), due_date: '', total_amount: '', paid_amount: 0, remarks: '' });
    setModal('add');
  };

  const openEdit = (p) => {
    setForm({ id: p.id, supplier_id: p.supplier_id, branch_id: p.branch_id, invoice_no: p.invoice_no || '', purchase_date: p.purchase_date, due_date: p.due_date || '', total_amount: p.total_amount, paid_amount: p.paid_amount ?? 0, remarks: p.remarks || '' });
    setModal('edit');
  };

  const openPay = (p) => {
    setPayForm({ purchase_id: p.id, supplier_id: p.supplier_id, amount: Math.max(0, (Number(p.balance) || 0)), payment_date: new Date().toISOString().slice(0, 10), mode: 'cash' });
    setPayModal(p);
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/purchases', { ...form, branch_id: form.branch_id || null });
      else await api.patch(`/purchases/${form.id}`, form);
      setModal(null);
      load();
      loadReminders();
    } catch (e) {
      setErr(e.message);
    }
  };

  const pay = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post(`/purchases/${payForm.purchase_id}/pay`, { amount: payForm.amount, payment_date: payForm.payment_date, mode: payForm.mode });
      setPayModal(null);
      load();
      loadReminders();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this purchase?')) return;
    try {
      await api.delete(`/purchases/${id}`);
      load();
      loadReminders();
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadAttachments = async (purchaseId) => {
    const rows = await api.get(`/purchases/${purchaseId}/attachments`);
    setAttachments(Array.isArray(rows) ? rows : []);
  };

  const openAttachments = async (p) => {
    setAttachmentsModal(p);
    setAttachments([]);
    try {
      await loadAttachments(p.id);
    } catch (e) {
      setErr(e.message);
    }
  };

  const uploadAttachments = async (purchaseId, files) => {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/purchases/${purchaseId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      await loadAttachments(purchaseId);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteAttachment = async (purchaseId, attId) => {
    try {
      await api.delete(`/purchases/${purchaseId}/attachments/${attId}`);
      await loadAttachments(purchaseId);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const normalize = (v) => String(v || '').toLowerCase();
  const needle = query.trim().toLowerCase();
  const filteredList = needle
    ? list.filter((p) => {
        const hay = [
          p.supplier_name,
          p.branch_name,
          p.invoice_no,
          p.remarks,
          p.purchase_date,
          p.due_date,
          p.total_amount,
          p.balance,
        ].map(normalize).join(' ');
        return hay.includes(needle);
      })
    : list;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Management</h1>
          <p className="text-slate-500 mt-1">Invoices, branch-wise purchases, payments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Purchase</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      {reminders.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="font-medium text-amber-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Due payment reminders</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left">Supplier</th><th className="text-left">Branch</th><th className="text-left">Due Date</th><th className="text-right">Balance</th><th className="text-left">Status</th></tr></thead>
              <tbody>
                {reminders.map((r) => (
                  <tr key={r.id}>
                    <td>{r.supplier_name || '–'}</td>
                    <td>{r.branch_name || '–'}</td>
                    <td>{r.due_date || '–'}</td>
                    <td className="text-right font-mono">{fmt(r.balance)}</td>
                    <td>{r.status === 'overdue' ? 'Overdue' : 'Due soon'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <select className="input w-48" value={filters.supplier_id} onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input w-48" value={filters.branch_id} onChange={(e) => setFilters({ ...filters, branch_id: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className="input w-40" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" className="input w-40" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <input
            className="input w-full md:w-[260px]"
            placeholder="Search by supplier, invoice, remarks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button onClick={load} className="btn-secondary">Apply</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Supplier</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Invoice</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Due Date</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Total</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Paid</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Balance</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredList.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{p.purchase_date}</td>
                  <td className="px-4 py-3 font-medium">{p.supplier_name}</td>
                  <td className="px-4 py-3">{p.branch_name || '–'}</td>
                  <td className="px-4 py-3 font-mono">{p.invoice_no || '–'}</td>
                  <td className="px-4 py-3">{p.due_date || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(p.total_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(p.paid_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{fmt(p.balance)}</td>
                  <td className="px-4 py-3 text-right">
                    {Number(p.balance) > 0 && <button onClick={() => openPay(p)} className="btn-primary text-xs mr-1">Pay</button>}
                    <button onClick={() => openAttachments(p)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Attach bill"><Paperclip className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(p)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(p.id)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredList.length && !loading && <p className="p-8 text-center text-slate-500">No purchases.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Purchase' : 'Edit Purchase'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Supplier *</label><select className="input" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Invoice #</label><input className="input" value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></div>
                <div><label className="label">Date *</label><input type="date" className="input" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} required /></div>
              </div>
              <div><label className="label">Due Date</label><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Total *</label><input type="number" step="0.01" className="input" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} required /></div>
                <div><label className="label">Paid</label><input type="number" step="0.01" className="input" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} /></div>
              </div>
              <div><label className="label">Remarks</label><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Pay — {payModal.supplier_name} (Balance {fmt(payModal.balance)})</h2>
            <form onSubmit={pay} className="space-y-4">
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required /></div>
              <div><label className="label">Date *</label><input type="date" className="input" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })} required /></div>
              <div><label className="label">Mode</label><select className="input" value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Pay</button><button type="button" onClick={() => setPayModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {attachmentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Attach Bill — {attachmentsModal.invoice_no || attachmentsModal.purchase_date}</h2>
            <div className="space-y-3">
              <input
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => uploadAttachments(attachmentsModal.id, e.target.files)}
                disabled={uploading}
              />
              {uploading && <p className="text-sm text-slate-500">Uploading…</p>}
              {attachments.length ? (
                <ul className="space-y-2">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <a className="text-sm text-primary-700 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>
                      <button onClick={() => deleteAttachment(attachmentsModal.id, a.id)} className="p-1.5 text-slate-500 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No attachments. Upload a bill (optional).</p>
              )}
            </div>
            <button type="button" onClick={() => { setAttachmentsModal(null); setAttachments([]); }} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}

    </div>
  );
}
