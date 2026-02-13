import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, Paperclip } from 'lucide-react';

export default function Expenses() {
  const [list, setList] = useState([]);
  const [categories, setCategories] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [filters, setFilters] = useState({ branch_id: '', category_id: '', from: '', to: '' });
  const [form, setForm] = useState({ branch_id: '', category_id: '', amount: '', expense_date: '', type: 'variable', is_recurring: false, remarks: '' });
  const [attachmentsModal, setAttachmentsModal] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [previewId, setPreviewId] = useState(null);

  const load = () => {
    const q = new URLSearchParams();
    if (filters.branch_id) q.set('branch_id', filters.branch_id);
    if (filters.category_id) q.set('category_id', filters.category_id);
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    api.get(`/expenses?${q}`).then(setList).catch((e) => setErr(e.message));
  };

  useEffect(() => { load(); }, [filters.branch_id, filters.category_id, filters.from, filters.to]);
  useEffect(() => { api.get('/expenses/categories').then(setCategories).catch(() => {}); api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ branch_id: '', category_id: categories[0]?.id || '', amount: '', expense_date: new Date().toISOString().slice(0, 10), type: 'variable', is_recurring: false, remarks: '' });
    setModal('add');
  };

  const openEdit = (e) => {
    setForm({ id: e.id, branch_id: e.branch_id || '', category_id: e.category_id || '', amount: e.amount, expense_date: e.expense_date, type: e.type || 'variable', is_recurring: !!e.is_recurring, remarks: e.remarks || '' });
    setModal('edit');
  };

  const save = async (ev) => {
    ev.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/expenses', { ...form, branch_id: form.branch_id || null, category_id: form.category_id || null });
      else await api.patch(`/expenses/${form.id}`, form);
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this expense?')) return;
    try {
      await api.delete(`/expenses/${id}`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadAttachments = async (expenseId) => {
    const rows = await api.get(`/expenses/${expenseId}/attachments`);
    setAttachments(Array.isArray(rows) ? rows : []);
  };

  const openAttachments = async (e) => {
    setAttachmentsModal(e);
    setAttachments([]);
    try {
      await loadAttachments(e.id);
    } catch (err) {
      setErr(err.message);
    }
  };

  const uploadAttachments = async (expenseId, files) => {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/expenses/${expenseId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      await loadAttachments(expenseId);
    } catch (err) {
      setErr(err.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteAttachment = async (expenseId, attId) => {
    try {
      await api.delete(`/expenses/${expenseId}/attachments/${attId}`);
      await loadAttachments(expenseId);
    } catch (err) {
      setErr(err.message);
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
          <h1 className="text-2xl font-bold text-slate-900">Expenses & Petty Cash</h1>
          <p className="text-slate-500 mt-1">Categories, branch-wise expenses, recurring</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Expense</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <select className="input w-48" value={filters.branch_id} onChange={(e) => setFilters({ ...filters, branch_id: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="input w-48" value={filters.category_id} onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                <th className="text-left px-4 py-3 font-medium text-slate-700">Category</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Recurring</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">{e.expense_date}</td>
                  <td className="px-4 py-3">{e.branch_name || '–'}</td>
                  <td className="px-4 py-3">{e.category_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(e.amount)}</td>
                  <td className="px-4 py-3 capitalize">{e.type || 'variable'}</td>
                  <td className="px-4 py-3">{e.is_recurring ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openAttachments(e)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Attachments"><Paperclip className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(e)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(e.id)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No expenses.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Expense' : 'Edit Expense'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="label">Category</label><select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
                <div><label className="label">Date *</label><input type="date" className="input" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required /></div>
              </div>
              <div><label className="label">Type</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="variable">Variable</option><option value="fixed">Fixed</option></select></div>
              <div className="flex items-center gap-2"><input type="checkbox" id="rec" checked={form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} /><label htmlFor="rec">Recurring</label></div>
              <div><label className="label">Remarks</label><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {attachmentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Attachments — {attachmentsModal.expense_date}</h2>
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
