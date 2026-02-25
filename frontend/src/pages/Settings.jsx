import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Save, FileText, X, Download, Upload, Trash2, AlertTriangle } from 'lucide-react';

const AUDIT_MODULES = ['', 'settings', 'sales', 'purchases', 'branches', 'users', 'banks', 'receivables', 'inventory', 'pl', 'staff'];

const SETTINGS_DEFAULTS = {
  financial_year_start: '', financial_year_end: '',
  invoice_prefix: 'INV', voucher_prefix: 'VCH', invoice_counter: '1', voucher_counter: '1',
  company_name: '', company_phone: '', company_address: '', company_email: '', company_website: '', company_tax_number: '',
};

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h3 className="text-base font-semibold text-slate-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const canBackupRestore = user?.role_name === 'Super Admin' || user?.role_name === 'Finance Manager';
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditModule, setAuditModule] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState('');
  const [clearLoading, setClearLoading] = useState(false);

  const update = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    api.get('/settings')
      .then((s) => setSettings({ ...SETTINGS_DEFAULTS, ...s }))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
    const token = localStorage.getItem('token');
    fetch('/api/settings/logo', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => setLogoUrl(URL.createObjectURL(blob)))
      .catch(() => setLogoUrl(null));
  }, []);

  useEffect(() => {
    if (!auditOpen) return;
    const q = new URLSearchParams({ limit: 100 });
    if (auditModule) q.set('module', auditModule);
    api.get(`/auth/activity-logs?${q}`).then(setAuditLogs).catch(() => setAuditLogs([]));
  }, [auditOpen, auditModule]);

  const save = async (e) => {
    e?.preventDefault();
    setErr('');
    setSaving(true);
    try {
      await api.post('/settings/bulk', settings);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const runBackup = async () => {
    setErr('');
    setBackupLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/settings/backup', {
        method: 'GET',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const blob = await res.blob();
      if (!res.ok) {
        let d = {};
        try { d = JSON.parse(await blob.text()); } catch (_) {}
        throw new Error(d.error || res.statusText || 'Backup failed');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const runRestore = async () => {
    if (!restoreFile) { setErr('Select a backup JSON file first.'); return; }
    setErr('');
    setRestoreLoading(true);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      const r = await api.post('/settings/restore', backup);
      setRestoreFile(null);
      const el = document.getElementById('settings-restore-file');
      if (el) el.value = '';
      setErr('');
      alert(r.message || 'Restore complete.');
    } catch (e) {
      setErr(e.message || 'Restore failed.');
    } finally {
      setRestoreLoading(false);
    }
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    setErr('');
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', logoFile);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/settings/logo', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Upload failed');
      const res2 = await fetch('/api/settings/logo', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (res2.ok) setLogoUrl(URL.createObjectURL(await res2.blob()));
      setLogoFile(null);
      const el = document.getElementById('settings-logo-file');
      if (el) el.value = '';
    } catch (e) {
      setErr(e.message);
    } finally {
      setLogoUploading(false);
    }
  };

  const runClearData = async () => {
    if (clearConfirm.trim().toUpperCase() !== 'CLEAR') {
      setErr('Type CLEAR to confirm.');
      return;
    }
    setErr('');
    setClearLoading(true);
    try {
      const res = await api.post('/settings/clear-data', {});
      alert(res.message || 'All transactional data has been cleared.');
      setClearModalOpen(false);
      setClearConfirm('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setClearLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Settings &amp; Utilities</h1>
          <p className="text-slate-500 mt-1">Financial year, auto numbering, backup, and audit logs</p>
        </div>
        <button onClick={save} className="btn-primary" disabled={saving}><Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save all'}</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Financial year setup">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Start</label><input type="date" className="input" value={settings.financial_year_start || ''} onChange={(e) => update('financial_year_start', e.target.value)} /></div>
            <div><label className="label">End</label><input type="date" className="input" value={settings.financial_year_end || ''} onChange={(e) => update('financial_year_end', e.target.value)} /></div>
          </div>
        </Section>

        <Section title="Auto numbering (invoice, voucher)">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="label">Invoice prefix</label><input className="input" value={settings.invoice_prefix || 'INV'} onChange={(e) => update('invoice_prefix', e.target.value)} /></div>
            <div><label className="label">Next invoice #</label><input type="number" min="1" className="input" value={settings.invoice_counter ?? '1'} onChange={(e) => update('invoice_counter', e.target.value)} /></div>
            <div><label className="label">Voucher prefix</label><input className="input" value={settings.voucher_prefix || 'VCH'} onChange={(e) => update('voucher_prefix', e.target.value)} /></div>
            <div><label className="label">Next voucher #</label><input type="number" min="1" className="input" value={settings.voucher_counter ?? '1'} onChange={(e) => update('voucher_counter', e.target.value)} /></div>
          </div>
        </Section>

        <Section title="Company details (for exports &amp; print)">
          <p className="text-sm text-slate-600 mb-4">Shown in headers of all PDF, Excel, and print exports.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label">Company name</label><input className="input" value={settings.company_name || ''} onChange={(e) => update('company_name', e.target.value)} placeholder="Your business name" /></div>
            <div><label className="label">Phone</label><input className="input" value={settings.company_phone || ''} onChange={(e) => update('company_phone', e.target.value)} placeholder="+92 300 1234567" /></div>
            <div><label className="label">Email</label><input type="email" className="input" value={settings.company_email || ''} onChange={(e) => update('company_email', e.target.value)} placeholder="info@company.com" /></div>
            <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={settings.company_address || ''} onChange={(e) => update('company_address', e.target.value)} placeholder="Street, city, country" /></div>
            <div><label className="label">Website</label><input type="url" className="input" value={settings.company_website || ''} onChange={(e) => update('company_website', e.target.value)} placeholder="https://www.example.com" /></div>
            <div><label className="label">Tax number</label><input className="input" value={settings.company_tax_number || ''} onChange={(e) => update('company_tax_number', e.target.value)} placeholder="NTN / VAT" /></div>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-200">
            <label className="label">Logo (max 15MB, PNG/JPG/WebP)</label>
            <div className="flex flex-wrap items-center gap-4 mt-2">
              {logoUrl && (
                <div className="flex items-center gap-3">
                  <img src={logoUrl} alt="Company logo" className="h-16 object-contain border border-slate-200 rounded-lg bg-white" />
                  <span className="text-sm text-slate-500">Current logo</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="settings-logo-file" className="btn-secondary flex items-center gap-2 cursor-pointer inline-flex">
                  <Upload className="w-4 h-4" /> {logoUrl ? 'Replace' : 'Upload'} logo
                </label>
                <input id="settings-logo-file" type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                {logoFile && (
                  <>
                    <span className="text-sm text-slate-600">{logoFile.name}</span>
                    <button type="button" onClick={uploadLogo} disabled={logoUploading} className="btn-primary text-sm">
                      {logoUploading ? 'Uploading…' : 'Save logo'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Local Backup &amp; Restore">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Download or restore a local backup of your database.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runBackup} disabled={!canBackupRestore || backupLoading} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" /> {backupLoading ? 'Creating…' : 'Download Backup'}</button>
              <label htmlFor="settings-restore-file" className={`btn-secondary flex items-center gap-2 cursor-pointer inline-flex ${!canBackupRestore ? 'opacity-50 pointer-events-none' : ''}`}><Upload className="w-4 h-4" /> Choose file</label>
              <input id="settings-restore-file" type="file" accept=".json" className="hidden" onChange={(e) => setRestoreFile(e.target.files?.[0] || null)} />
              <button type="button" onClick={runRestore} disabled={!canBackupRestore || !restoreFile || restoreLoading} className="btn-primary">Restore from backup</button>
              {restoreFile && <span className="text-sm text-slate-500">{restoreFile.name}</span>}
            </div>
          </div>
        </Section>

        <Section title="Audit logs">
          <p className="text-sm text-slate-600 mb-3">View user activity and change history.</p>
          <button type="button" onClick={() => setAuditOpen(true)} className="btn-secondary"><FileText className="w-4 h-4" /> View audit logs</button>
        </Section>

        <Section title="Danger zone — Clear all data">
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-rose-700">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <p>
                This will permanently delete all <strong>sales, receivables, purchases, payments, bank transactions, inventory sales, rent bills</strong>,
                and related attachments and logs. Master data (branches, banks, products, suppliers, users, and settings) will be kept.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setClearModalOpen(true); setClearConfirm(''); }}
              disabled={user?.role_name !== 'Super Admin'}
              className="btn-secondary border-rose-500 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 mr-1" /> Clear all transactional data
            </button>
            {user?.role_name !== 'Super Admin' && (
              <p className="text-xs text-slate-500">Only Super Admin can clear data.</p>
            )}
          </div>
        </Section>
      </div>

      {auditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Audit logs</h3>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Module</label>
                <select className="input w-40 text-sm" value={auditModule} onChange={(e) => setAuditModule(e.target.value)}>
                  <option value="">All</option>
                  {AUDIT_MODULES.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => setAuditOpen(false)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200"><tr><th className="text-left px-3 py-2 font-medium text-slate-700">User</th><th className="text-left px-3 py-2 font-medium text-slate-700">Action</th><th className="text-left px-3 py-2 font-medium text-slate-700">Module</th><th className="text-left px-3 py-2 font-medium text-slate-700">Time</th></tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {auditLogs.map((a) => (
                    <tr key={a.id}><td className="px-3 py-2">{a.name || a.email || '–'}</td><td className="px-3 py-2">{a.action}</td><td className="px-3 py-2">{a.module}</td><td className="px-3 py-2 text-slate-500">{a.created_at}</td></tr>
                  ))}
                </tbody>
              </table>
              {!auditLogs.length && <p className="py-8 text-center text-slate-500">No audit logs.</p>}
            </div>
          </div>
        </div>
      )}

      {clearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Clear all transactional data</h2>
              <button
                type="button"
                onClick={() => { setClearModalOpen(false); setClearConfirm(''); }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-slate-700">
                <AlertTriangle className="w-5 h-5 mt-0.5 text-rose-600" />
                <p>
                  This action will permanently delete <strong>all transactional records</strong>:
                  sales, receivables and recoveries, purchases, payments, bank transactions, inventory sales,
                  rent bills, and their attachments and logs. This cannot be undone.
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-2">
                  To confirm, type <span className="font-mono font-semibold">CLEAR</span> in the box below.
                </p>
                <input
                  className="input w-full"
                  value={clearConfirm}
                  onChange={(e) => setClearConfirm(e.target.value)}
                  placeholder="Type CLEAR to confirm"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={runClearData}
                  disabled={clearLoading || clearConfirm.trim().toUpperCase() !== 'CLEAR'}
                  className="btn-primary bg-rose-600 hover:bg-rose-700 border-rose-700 disabled:opacity-50"
                >
                  {clearLoading ? 'Clearing…' : 'Yes, delete all data'}
                </button>
                <button
                  type="button"
                  onClick={() => { setClearModalOpen(false); setClearConfirm(''); }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
