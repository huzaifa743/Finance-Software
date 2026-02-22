import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, Paperclip } from 'lucide-react';

export default function RentBills() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'bill', amount: '', due_date: '', remarks: '' });
  const [attachmentsModal, setAttachmentsModal] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');

  const load = () => api.get('/rent-bills').then(setList).catch((e) => setErr(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setEditing(null);
    setForm({ title: '', category: 'bill', amount: '', due_date: '', remarks: '' });
    setModal('add');
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      title: r.title,
      category: r.category || 'bill',
      amount: r.amount ?? '',
      due_date: r.due_date || '',
      remarks: r.remarks || '',
    });
    setModal('edit');
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/rent-bills', form);
      else await api.patch(`/rent-bills/${editing.id}`, form);
      setModal(null);
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete "${r.title}"?`)) return;
    setErr('');
    try {
      await api.delete(`/rent-bills/${r.id}`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const loadAttachments = async (id) => {
    const rows = await api.get(`/rent-bills/${id}/attachments`);
    setAttachments(Array.isArray(rows) ? rows : []);
  };

  const openAttachments = async (r) => {
    setAttachmentsModal(r);
    setAttachments([]);
    try {
      await loadAttachments(r.id);
    } catch (e) {
      setErr(e.message);
    }
  };

  const uploadAttachments = async (id, files) => {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/rent-bills/${id}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      await loadAttachments(id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  const deleteAttachment = async (rentBillId, attId) => {
    try {
      await api.delete(`/rent-bills/${rentBillId}/attachments/${attId}`);
      await loadAttachments(rentBillId);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const filtered = filterCategory ? list.filter((r) => r.category === filterCategory) : list;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rent & Bills</h1>
          <p className="text-slate-500 mt-1">Add rent and bills with optional documents. Pay from Payments.</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Rent / Bill</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <select className="input w-48" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">All (Rent & Bill)</option>
            <option value="rent">Rent</option>
            <option value="bill">Bill</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Title</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Category</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Paid</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Balance</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Due Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((r) => {
                const balance = (Number(r.amount) || 0) - (Number(r.paid_amount) || 0);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.title}</td>
                    <td className="px-4 py-3 capitalize">{r.category || 'bill'}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(r.amount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(r.paid_amount)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{fmt(balance)}</td>
                    <td className="px-4 py-3">{r.due_date || '–'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'partial' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openAttachments(r)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Documents"><Paperclip className="w-4 h-4" /></button>
                      <button onClick={() => openEdit(r)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(r)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && !loading && <p className="p-8 text-center text-slate-500">No rent or bills. Add one to get started.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Rent / Bill' : 'Edit Rent / Bill'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Title *</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Office Rent Jan 2025" /></div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="rent">Rent</option>
                  <option value="bill">Bill</option>
                </select>
              </div>
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
              <div><label className="label">Due Date</label><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              <div><label className="label">Remarks</label><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => { setModal(null); setEditing(null); }} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {attachmentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Documents — {attachmentsModal.title}</h2>
            <div className="space-y-3">
              <input type="file" multiple accept="image/*,.pdf" onChange={(e) => uploadAttachments(attachmentsModal.id, e.target.files)} disabled={uploading} />
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
                <p className="text-sm text-slate-500">No documents attached.</p>
              )}
            </div>
            <button type="button" onClick={() => { setAttachmentsModal(null); setAttachments([]); }} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
