import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Plus, Pencil, Lock, Unlock, Paperclip, Trash2 } from 'lucide-react';

export default function Sales() {
  const { user } = useAuth();
  const canLock = user?.role_name === 'Super Admin' || user?.role_name === 'Finance Manager';
  const canMutate = user?.role_name !== 'Auditor';
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ branch_id: '', from: '', to: '', type: '' });
  const [form, setForm] = useState({
    branch_id: '', sale_date: new Date().toISOString().slice(0, 10), type: 'cash',
    cash_amount: 0, bank_amount: 0, credit_amount: 0, discount: 0, returns_amount: 0, remarks: '',
  });
  const [attachmentsModal, setAttachmentsModal] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [previewId, setPreviewId] = useState(null);

  const load = () => {
    const q = new URLSearchParams();
    if (filters.branch_id) q.set('branch_id', filters.branch_id);
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    if (filters.type) q.set('type', filters.type);
    api.get(`/sales?${q}`).then(setList).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
  }, [filters.branch_id, filters.from, filters.to, filters.type]);

  useEffect(() => {
    api.get('/branches?active=1').then(setBranches).catch(() => {});
  }, []);

  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({
      branch_id: branches[0]?.id || '', sale_date: new Date().toISOString().slice(0, 10), type: 'cash',
      cash_amount: 0, bank_amount: 0, credit_amount: 0, discount: 0, returns_amount: 0, remarks: '',
    });
    setModal('add');
  };

  const openEdit = (s) => {
    setForm({
      id: s.id,
      branch_id: s.branch_id,
      sale_date: s.sale_date,
      type: s.type || 'cash',
      cash_amount: s.cash_amount ?? 0,
      bank_amount: s.bank_amount ?? 0,
      credit_amount: s.credit_amount ?? 0,
      discount: s.discount ?? 0,
      returns_amount: s.returns_amount ?? 0,
      remarks: s.remarks || '',
    });
    setModal('edit');
  };

  const net = () => Math.max(0,
    (Number(form.cash_amount) || 0) + (Number(form.bank_amount) || 0) + (Number(form.credit_amount) || 0) -
    (Number(form.discount) || 0) - (Number(form.returns_amount) || 0)
  );

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') {
        await api.post('/sales', { ...form, branch_id: form.branch_id || null });
      } else {
        const { id, ...patch } = form;
        await api.patch(`/sales/${id}`, patch);
      }
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const toggleLock = async (s) => {
    try {
      await api.post(`/sales/${s.id}/lock`, { lock: !s.is_locked });
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadAttachments = async (saleId) => {
    const rows = await api.get(`/sales/${saleId}/attachments`);
    setAttachments(Array.isArray(rows) ? rows : []);
  };

  const openAttachments = async (s) => {
    setAttachmentsModal(s);
    setAttachments([]);
    try {
      await loadAttachments(s.id);
    } catch (e) {
      setErr(e.message);
    }
  };

  const uploadAttachments = async (saleId, files) => {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sales/${saleId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      await loadAttachments(saleId);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteAttachment = async (saleId, attId) => {
    try {
      await api.delete(`/sales/${saleId}/attachments/${attId}`);
      await loadAttachments(saleId);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fileType = (name) => {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'other';
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Management</h1>
          <p className="text-slate-500 mt-1">Daily sales entry, cash / bank / credit, discount & returns</p>
        </div>
        {canMutate && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Sale</button>}
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <select className="input w-48" value={filters.branch_id} onChange={(e) => setFilters({ ...filters, branch_id: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className="input w-40" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} placeholder="From" />
          <input type="date" className="input w-40" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} placeholder="To" />
          <select className="input w-40" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">All types</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
          </select>
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
                <th className="text-left px-4 py-3 font-medium text-slate-700">Type</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Cash</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Bank</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Credit</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Discount</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Returns</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Net</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Locked</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{s.sale_date}</td>
                  <td className="px-4 py-3">{s.branch_name || '–'}</td>
                  <td className="px-4 py-3 capitalize">{s.type || 'cash'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.cash_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.bank_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.credit_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.discount)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.returns_amount)}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{fmt(s.net_sales)}</td>
                  <td className="px-4 py-3">{s.is_locked ? <Lock className="w-4 h-4 text-amber-500" /> : <Unlock className="w-4 h-4 text-slate-400" />}</td>
                  <td className="px-4 py-3 text-right">
                    {canLock && <button onClick={() => toggleLock(s)} className="p-1.5 text-slate-500 hover:text-amber-600" title={s.is_locked ? 'Unlock' : 'Lock'}>{s.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}</button>}
                    <button onClick={() => openAttachments(s)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Attachments"><Paperclip className="w-4 h-4" /></button>
                    {canMutate && <button onClick={() => openEdit(s)} disabled={!!s.is_locked} className="p-1.5 text-slate-500 hover:text-primary-600 disabled:opacity-50"><Pencil className="w-4 h-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No sales. Add a sale to get started.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Sale' : 'Edit Sale'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Branch</label>
                  <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                    <option value="">–</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Cash</label><input type="number" step="0.01" className="input" value={form.cash_amount} onChange={(e) => setForm({ ...form, cash_amount: e.target.value })} /></div>
                <div><label className="label">Bank</label><input type="number" step="0.01" className="input" value={form.bank_amount} onChange={(e) => setForm({ ...form, bank_amount: e.target.value })} /></div>
                <div><label className="label">Credit</label><input type="number" step="0.01" className="input" value={form.credit_amount} onChange={(e) => setForm({ ...form, credit_amount: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Discount</label><input type="number" step="0.01" className="input" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></div>
                <div><label className="label">Returns</label><input type="number" step="0.01" className="input" value={form.returns_amount} onChange={(e) => setForm({ ...form, returns_amount: e.target.value })} /></div>
              </div>
              <p className="text-sm font-medium text-slate-700">Net sales: {fmt(net())}</p>
              <div><label className="label">Remarks</label><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="btn-primary">Save</button>
                <button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {attachmentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Attachments — {attachmentsModal.sale_date}</h2>
            <div className="space-y-3">
              <input
                type="file"
                multiple
                onChange={(e) => uploadAttachments(attachmentsModal.id, e.target.files)}
                disabled={uploading}
              />
              {uploading && <p className="text-sm text-slate-500">Uploading…</p>}
              {attachments.length ? (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <a className="text-sm text-primary-700 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                            className="text-xs text-slate-600 hover:text-primary-600"
                          >
                            {previewId === a.id ? 'Hide' : 'Preview'}
                          </button>
                          <button onClick={() => deleteAttachment(attachmentsModal.id, a.id)} className="p-1.5 text-slate-500 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      {previewId === a.id && (
                        <div className="mt-3">
                          {fileType(a.filename) === 'image' && (
                            <img src={a.url} alt={a.filename} className="max-h-80 w-auto rounded border border-slate-200" loading="lazy" />
                          )}
                          {fileType(a.filename) === 'pdf' && (
                            <iframe title={a.filename} src={a.url} className="h-80 w-full rounded border border-slate-200" />
                          )}
                          {fileType(a.filename) === 'other' && (
                            <p className="text-sm text-slate-500">Preview not available. Use the file link above.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No attachments.</p>
              )}
            </div>
            <button type="button" onClick={() => { setAttachmentsModal(null); setAttachments([]); }} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
