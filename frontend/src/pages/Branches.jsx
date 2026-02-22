import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Trash2, MapPin, User, Calendar } from 'lucide-react';

export default function Branches() {
  const [list, setList] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', location: '', manager_user_id: '', opening_date: '', closing_date: '', is_active: true });

  const load = () => {
    api.get('/branches').then(setList).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    api.get('/auth/users').then(setUsers).catch(() => {});
  }, []);

  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ code: '', name: '', location: '', manager_user_id: '', opening_date: '', closing_date: '', is_active: true });
    setModal('add');
  };

  const openEdit = (b) => {
    setForm({
      id: b.id,
      code: b.code,
      name: b.name,
      location: b.location || '',
      manager_user_id: b.manager_user_id || '',
      opening_date: b.opening_date || '',
      closing_date: b.closing_date || '',
      is_active: !!b.is_active,
    });
    setModal('edit');
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const payload = { ...form, code: form.code || null, manager_user_id: form.manager_user_id || null };
      if (modal === 'add') {
        await api.post('/branches', payload);
      } else {
        await api.patch(`/branches/${form.id}`, payload);
      }
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this branch?')) return;
    try {
      await api.delete(`/branches/${id}`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Branch Management</h1>
          <p className="text-slate-500 mt-1">Add, edit, and monitor branches</p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus className="w-4 h-4" /> Add Branch
        </button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Code</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Location</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Manager</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Opening / Closing</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono">{b.code || '–'}</td>
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-slate-600">{b.location || '–'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.manager_name || '–'}</td>
                  <td className="px-4 py-3 text-slate-600">{b.opening_date || '–'} / {b.closing_date || '–'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${b.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(b)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(b.id)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No branches yet. Add one to get started.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Branch' : 'Edit Branch'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Code (optional)</label>
                  <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BR001" />
                </div>
                <div>
                  <label className="label">Name *</label>
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
              </div>
              <div>
                <label className="label">Location</label>
                <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Address" />
              </div>
              <div>
                <label className="label">Branch Manager</label>
                <select className="input" value={form.manager_user_id} onChange={(e) => setForm({ ...form, manager_user_id: e.target.value })}>
                  <option value="">– Select –</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role_name})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Opening Date</label>
                  <input type="date" className="input" value={form.opening_date} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
                </div>
                <div>
                  <label className="label">Closing Date</label>
                  <input type="date" className="input" value={form.closing_date} onChange={(e) => setForm({ ...form, closing_date: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                <label htmlFor="active">Active</label>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="btn-primary">Save</button>
                <button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
