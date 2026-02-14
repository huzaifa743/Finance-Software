import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Plus, Pencil, History, Activity, X } from 'lucide-react';

const ROLE_DISPLAY = {
  'Super Admin': 'Super Admin (Owner)',
  'Finance Manager': 'Finance Manager',
  'Branch Manager': 'Branch Manager',
  'Data Entry Operator': 'Data Entry Operator',
  'Auditor': 'Auditor (read-only)',
};

const AUDIT_MODULES = ['', 'settings', 'sales', 'expenses', 'purchases', 'branches', 'users', 'expense_categories', 'cash', 'banks', 'receivables', 'inventory', 'pl', 'staff'];

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role_id: '', branch_id: '', is_active: true });
  const [loginHistory, setLoginHistory] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(null);
  const [auditModule, setAuditModule] = useState('');

  const isAuditor = user?.role_name === 'Auditor';
  const canMutate = !isAuditor;

  const load = () => api.get('/auth/users').then(setUsers).catch((e) => setErr(e.message));

  useEffect(() => { load(); api.get('/auth/roles').then(setRoles).catch(() => {}); api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);
  useEffect(() => { setLoading(false); }, [users]);

  useEffect(() => {
    if (logsOpen !== 'activity') return;
    const q = new URLSearchParams({ limit: 100 });
    if (auditModule) q.set('module', auditModule);
    api.get(`/auth/activity-logs?${q}`).then(setActivityLogs).catch(() => setActivityLogs([]));
  }, [logsOpen, auditModule]);

  const openAdd = () => {
    setForm({ email: '', password: 'user123', name: '', role_id: roles[1]?.id || roles[0]?.id || '', branch_id: '', is_active: true });
    setModal('add');
  };

  const openEdit = (u) => {
    setForm({ id: u.id, email: u.email, name: u.name, role_id: u.role_id, branch_id: u.branch_id || '', is_active: !!u.is_active, password: '' });
    setModal('edit');
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') {
        await api.post('/auth/users', { ...form, branch_id: form.branch_id || null });
      } else {
        const payload = { name: form.name, role_id: form.role_id, branch_id: form.branch_id || null, is_active: form.is_active };
        if (form.password) payload.password = form.password;
        await api.patch(`/auth/users/${form.id}`, payload);
      }
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openLoginHistory = () => {
    setLogsOpen('login');
    api.get('/auth/login-history?limit=100').then(setLoginHistory).catch(() => setLoginHistory([]));
  };

  const openActivityLogs = () => {
    setLogsOpen('activity');
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users &amp; Roles</h1>
          <p className="text-slate-500 mt-1">Manage users, roles, login history, and activity logs</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={openLoginHistory} className="btn-secondary"><History className="w-4 h-4" /> Login History</button>
          <button onClick={openActivityLogs} className="btn-secondary"><Activity className="w-4 h-4" /> Activity Logs</button>
          {canMutate && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>}
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Role</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
                <tbody className="divide-y divide-slate-200">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3">{u.email}</td>
                      <td className="px-4 py-3">{ROLE_DISPLAY[u.role_name] || u.role_name || '–'}</td>
                      <td className="px-4 py-3">{u.branch_name || '–'}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td className="px-4 py-3 text-right">{canMutate && <button onClick={() => openEdit(u)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
          </table>
        </div>
        {!users.length && !loading && <p className="p-8 text-center text-slate-500">No users.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add User' : 'Edit User'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Email *</label><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={modal === 'edit'} /></div>
              {modal === 'add' && <div><label className="label">Password</label><input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="user123" /></div>}
              {modal === 'edit' && <div><label className="label">New password (leave blank to keep)</label><input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>}
              <div><label className="label">Role *</label><select className="input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              {modal === 'edit' && <div className="flex items-center gap-2"><input type="checkbox" id="active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /><label htmlFor="active">Active</label></div>}
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {logsOpen === 'login' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Login History</h2>
              <button type="button" onClick={() => setLogsOpen(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto overflow-y-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">User</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">IP</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">Login At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loginHistory.map((h) => (
                    <tr key={h.id}><td className="px-4 py-3">{h.name} ({h.email})</td><td className="px-4 py-3">{h.ip || '–'}</td><td className="px-4 py-3">{h.login_at}</td></tr>
                  ))}
                </tbody>
              </table>
              {!loginHistory.length && <p className="py-8 text-center text-slate-500">No login history.</p>}
            </div>
          </div>
        </div>
      )}

      {logsOpen === 'activity' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Activity Logs</h2>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Module</label>
                <select className="input w-40 text-sm" value={auditModule} onChange={(e) => setAuditModule(e.target.value)}>
                  <option value="">All</option>
                  {AUDIT_MODULES.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => setLogsOpen(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto overflow-y-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">User</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">Action</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">Module</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">Details</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-700">At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activityLogs.map((a) => (
                    <tr key={a.id}><td className="px-4 py-3">{a.name || a.email || '–'}</td><td className="px-4 py-3">{a.action}</td><td className="px-4 py-3">{a.module}</td><td className="px-4 py-3 max-w-xs truncate">{a.details || '–'}</td><td className="px-4 py-3">{a.created_at}</td></tr>
                  ))}
                </tbody>
              </table>
              {!activityLogs.length && <p className="py-8 text-center text-slate-500">No activity logs.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
