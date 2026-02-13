import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { Save, FileText, Plus, Pencil, Trash2, X, Download, Upload } from 'lucide-react';

const REPORT_TYPES = [
  { value: 'summary', label: 'Summary (dashboard)' },
  { value: 'daily_sales', label: 'Daily sales' },
  { value: 'monthly_sales', label: 'Monthly sales' },
  { value: 'date_range_sales', label: 'Date-range sales' },
  { value: 'daily_expenses', label: 'Daily expenses' },
  { value: 'monthly_expenses', label: 'Monthly expenses' },
  { value: 'daily_purchases', label: 'Daily purchases' },
  { value: 'monthly_purchases', label: 'Monthly purchases' },
  { value: 'date_range_purchases', label: 'Date-range purchases' },
  { value: 'category_expenses', label: 'Category-wise expenses' },
  { value: 'inventory', label: 'Inventory sales (date range)' },
];
const LOCAL_TIMEZONES = (() => {
  try {
    if (!Intl.supportedValuesOf) return [];
    return Intl.supportedValuesOf('timeZone').slice().sort();
  } catch {
    return [];
  }
})();
const AUDIT_MODULES = ['', 'settings', 'sales', 'expenses', 'purchases', 'branches', 'users', 'expense_categories', 'cash', 'banks', 'receivables', 'inventory', 'pl', 'staff'];

const SETTINGS_DEFAULTS = {
  financial_year_start: '', financial_year_end: '', currency: 'PKR', country: 'PK', tax_rate: '18',
  invoice_prefix: 'INV', voucher_prefix: 'VCH', invoice_counter: '1', voucher_counter: '1',
  language: 'en', notification_alerts: '1', cloud_backup: '0',
  report_email_auto: '0', report_email_manual: '1', report_whatsapp_auto: '0', report_whatsapp_manual: '1',
  report_email_recipients: '', report_whatsapp_numbers: '',
  report_auto_time: '09:00', report_auto_timezone: 'UTC', report_auto_type: 'summary',
  drive_enabled: '0', drive_folder_id: '', translate_enabled: '0',
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
  const { setLanguage, setTranslateEnabled } = useI18n();
  const canBackupRestore = user?.role_name === 'Super Admin' || user?.role_name === 'Finance Manager';
  const [settings, setSettings] = useState({});
  const [countries, setCountries] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [categoryModal, setCategoryModal] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'variable' });
  const [sendReportType, setSendReportType] = useState('email');
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSuccess, setReportSuccess] = useState('');
  const [reportType, setReportType] = useState('summary');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportMonth, setReportMonth] = useState(String(new Date().getMonth() + 1));
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportBranchId, setReportBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [auditModule, setAuditModule] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const localCurrencies = (() => {
    try {
      if (!Intl.supportedValuesOf) return [];
      const dn = new Intl.DisplayNames(['en'], { type: 'currency' });
      return Intl.supportedValuesOf('currency').map((code) => ({ code, name: dn.of(code) || code }));
    } catch {
      return [];
    }
  })();

  const currencyList = currencies.length ? currencies : localCurrencies;
  const timezoneOptions = (() => {
    const selected = settings.report_auto_timezone || 'UTC';
    const list = LOCAL_TIMEZONES.length ? LOCAL_TIMEZONES : ['UTC'];
    return list.includes(selected) ? list : [selected, ...list];
  })();

  const update = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    Promise.all([
      api.get('/settings'),
      api.get('/settings/countries').catch(() => []),
      api.get('/settings/languages').catch(() => []),
      api.get('/settings/currencies').catch(() => []),
      api.get('/expenses/categories').catch(() => []),
      api.get('/branches').catch(() => []),
    ])
      .then(([s, c, l, cur, cat, br]) => {
        setSettings({ ...SETTINGS_DEFAULTS, ...s });
        if (s?.language) setLanguage(s.language);
        if (s?.translate_enabled != null) setTranslateEnabled(String(s.translate_enabled) !== '0');
        setCountries(Array.isArray(c) ? c : []);
        setLanguages(Array.isArray(l) ? l : []);
        setCurrencies(Array.isArray(cur) ? cur : []);
        setCategories(Array.isArray(cat) ? cat : []);
        setBranches(Array.isArray(br) ? br : []);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
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
      if (settings.language) setLanguage(settings.language);
      if (settings.translate_enabled != null) setTranslateEnabled(String(settings.translate_enabled) !== '0');
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const runCloudBackup = async () => {
    setErr('');
    setBackupLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/settings/backup/cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ folder_id: settings.drive_folder_id || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Cloud backup failed');
      setErr('');
      alert('Cloud backup uploaded successfully.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const saveCategory = async (ev) => {
    ev.preventDefault();
    setErr('');
    try {
      if (categoryModal === 'add') await api.post('/expenses/categories', categoryForm);
      else await api.patch(`/expenses/categories/${categoryForm.id}`, categoryForm);
      setCategoryModal(null);
      const cat = await api.get('/expenses/categories');
      setCategories(cat);
    } catch (e) {
      setErr(e.message);
    }
  };

  const deleteCategory = async (id) => {
    if (!confirm('Remove this category?')) return;
    try {
      await api.delete(`/expenses/categories/${id}`);
      const cat = await api.get('/expenses/categories');
      setCategories(cat);
    } catch (e) {
      setErr(e.message);
    }
  };

  const sendReport = async () => {
    setErr('');
    setReportSuccess('');
    if (['date_range_sales', 'date_range_purchases', 'inventory'].includes(reportType) && (!reportFrom || !reportTo)) {
      setErr('Select From and To dates for the selected report.');
      return;
    }
    const rec = sendReportType === 'email' ? settings.report_email_recipients : settings.report_whatsapp_numbers;
    if (!rec?.trim()) {
      setErr('Add email recipients or WhatsApp numbers in the fields above, then try again.');
      return;
    }
    setSendingReport(true);
    try {
      const body = {
        type: sendReportType,
        reportType,
        recipients: rec.trim(),
        branch_id: reportBranchId || undefined,
      };
      if (['daily_sales', 'daily_expenses', 'daily_purchases'].includes(reportType)) body.date = reportDate;
      if (['monthly_sales', 'monthly_expenses', 'monthly_purchases'].includes(reportType)) {
        body.month = reportMonth;
        body.year = reportYear;
      }
      if (['date_range_sales', 'date_range_purchases', 'inventory', 'category_expenses'].includes(reportType)) {
        body.from = reportFrom;
        body.to = reportTo;
      }
      const r = await api.post('/settings/send-report', body);
      setReportSuccess(r.message || 'Report sent.');
    } catch (e) {
      setErr(e.message || 'Send failed.');
    } finally {
      setSendingReport(false);
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
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || res.statusText || 'Backup failed');
      }
      const blob = await res.blob();
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

  const onCountryChange = (code) => {
    update('country', code);
    const c = countries.find((x) => x.code === code);
    if (c && c.taxRate != null) update('tax_rate', String(c.taxRate));
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Settings &amp; Utilities</h1>
          <p className="text-slate-500 mt-1">Customization &amp; control — financial year, currency, tax, categories, language, numbering, alerts, backup, audit, reports</p>
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

        <Section title="Currency &amp; tax settings (all countries)">
          <div className="space-y-4">
            <div><label className="label">Currency</label><select className="input" value={settings.currency || 'PKR'} onChange={(e) => update('currency', e.target.value)}>{currencyList.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}</select></div>
            <div><label className="label">Country (tax)</label><select className="input" value={settings.country || 'PK'} onChange={(e) => onCountryChange(e.target.value)}>{countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
            <div><label className="label">Tax rate %</label><input type="number" step="0.01" min="0" className="input" value={settings.tax_rate ?? ''} onChange={(e) => update('tax_rate', e.target.value)} placeholder="0" /></div>
          </div>
        </Section>

        <Section title="Category management">
          <div className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-slate-600">Expense categories</span><button type="button" onClick={() => { setCategoryForm({ name: '', type: 'variable' }); setCategoryModal('add'); }} className="btn-secondary text-sm"><Plus className="w-4 h-4" /> Add</button></div>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{c.name} <span className="text-slate-400">({c.type})</span></span><div><button type="button" onClick={() => { setCategoryForm({ id: c.id, name: c.name, type: c.type || 'variable' }); setCategoryModal('edit'); }} className="p-1 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button><button type="button" onClick={() => deleteCategory(c.id)} className="p-1 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></li>
              ))}
            </ul>
            {!categories.length && <p className="text-sm text-slate-500 py-2">No categories. Add one.</p>}
          </div>
        </Section>

        <Section title="Select language">
          <div><label className="label">Language</label><select className="input" value={settings.language || 'en'} onChange={(e) => { update('language', e.target.value); setLanguage(e.target.value); }}>{languages.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
        </Section>

        <Section title="Translation (Google)">
          <div className="space-y-2">
            <div className="flex items-center gap-3"><input type="checkbox" id="translate" checked={!!parseInt(settings.translate_enabled)} onChange={(e) => { update('translate_enabled', e.target.checked ? '1' : '0'); setTranslateEnabled(e.target.checked); }} /><label htmlFor="translate">Enable auto-translation</label></div>
            <p className="text-sm text-slate-500">Requires Google Translate credentials on the server.</p>
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

        <Section title="Notification alerts">
          <div className="flex items-center gap-3"><input type="checkbox" id="alerts" checked={!!parseInt(settings.notification_alerts)} onChange={(e) => update('notification_alerts', e.target.checked ? '1' : '0')} /><label htmlFor="alerts">Enable notification alerts</label></div>
        </Section>

        <Section title="Cloud backup">
          <div className="space-y-3">
            <div className="flex items-center gap-3"><input type="checkbox" id="backup" checked={!!parseInt(settings.cloud_backup)} onChange={(e) => update('cloud_backup', e.target.checked ? '1' : '0')} /><label htmlFor="backup">Enable cloud backup</label></div>
            <div><label className="label">Google Drive folder ID (optional)</label><input className="input" value={settings.drive_folder_id || ''} onChange={(e) => update('drive_folder_id', e.target.value)} placeholder="Folder ID or leave blank" /></div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runBackup} disabled={!canBackupRestore || backupLoading} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" /> {backupLoading ? 'Creating…' : 'Backup now (download JSON)'}</button>
              <button type="button" onClick={runCloudBackup} disabled={!canBackupRestore || backupLoading} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" /> Upload to Drive</button>
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

        <Section title="WhatsApp / Email reports (Auto and Manual)">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3"><input type="checkbox" id="email_auto" checked={!!parseInt(settings.report_email_auto)} onChange={(e) => update('report_email_auto', e.target.checked ? '1' : '0')} /><label htmlFor="email_auto">Email reports — Auto</label></div>
              <div className="flex items-center gap-3"><input type="checkbox" id="email_manual" checked={!!parseInt(settings.report_email_manual)} onChange={(e) => update('report_email_manual', e.target.checked ? '1' : '0')} /><label htmlFor="email_manual">Email reports — Manual</label></div>
              <div className="flex items-center gap-3"><input type="checkbox" id="wa_auto" checked={!!parseInt(settings.report_whatsapp_auto)} onChange={(e) => update('report_whatsapp_auto', e.target.checked ? '1' : '0')} /><label htmlFor="wa_auto">WhatsApp — Auto</label></div>
              <div className="flex items-center gap-3"><input type="checkbox" id="wa_manual" checked={!!parseInt(settings.report_whatsapp_manual)} onChange={(e) => update('report_whatsapp_manual', e.target.checked ? '1' : '0')} /><label htmlFor="wa_manual">WhatsApp — Manual</label></div>
            </div>
            <div><label className="label">Email recipients (comma-separated)</label><input className="input" value={settings.report_email_recipients || ''} onChange={(e) => update('report_email_recipients', e.target.value)} placeholder="a@x.com, b@y.com" /></div>
            <div><label className="label">WhatsApp numbers (comma-separated)</label><input className="input" value={settings.report_whatsapp_numbers || ''} onChange={(e) => update('report_whatsapp_numbers', e.target.value)} placeholder="+92 300 1234567" /></div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><label className="label">Auto report time</label><input type="time" className="input" value={settings.report_auto_time || '09:00'} onChange={(e) => update('report_auto_time', e.target.value)} /></div>
              <div><label className="label">Timezone</label><select className="input" value={settings.report_auto_timezone || 'UTC'} onChange={(e) => update('report_auto_timezone', e.target.value)}>{timezoneOptions.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</select></div>
              <div><label className="label">Auto report type</label><select className="input" value={settings.report_auto_type || 'summary'} onChange={(e) => update('report_auto_type', e.target.value)}>{REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Send report now (manual)</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Report type</label><select className="input" value={reportType} onChange={(e) => setReportType(e.target.value)}>{REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
                <div><label className="label">Channel</label><select className="input" value={sendReportType} onChange={(e) => setSendReportType(e.target.value)}><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></div>
                {['daily_sales', 'daily_expenses', 'daily_purchases'].includes(reportType) && <div><label className="label">Date</label><input type="date" className="input" value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></div>}
                {['monthly_sales', 'monthly_expenses', 'monthly_purchases'].includes(reportType) && (
                  <>
                    <div><label className="label">Month</label><select className="input" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>{[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}</option>)}</select></div>
                    <div><label className="label">Year</label><input type="number" min="2020" max="2030" className="input" value={reportYear} onChange={(e) => setReportYear(e.target.value)} /></div>
                  </>
                )}
                {['date_range_sales', 'date_range_purchases', 'inventory', 'category_expenses'].includes(reportType) && (
                  <>
                    <div><label className="label">From</label><input type="date" className="input" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} /></div>
                    <div><label className="label">To</label><input type="date" className="input" value={reportTo} onChange={(e) => setReportTo(e.target.value)} /></div>
                  </>
                )}
                <div><label className="label">Branch (optional)</label><select className="input" value={reportBranchId} onChange={(e) => setReportBranchId(e.target.value)}><option value="">All</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button type="button" onClick={sendReport} disabled={sendingReport} className="btn-primary">Send report now</button>
                {reportSuccess && <span className="text-sm text-green-600">{reportSuccess}</span>}
              </div>
            </div>
          </div>
        </Section>
      </div>

      {categoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">{categoryModal === 'add' ? 'Add category' : 'Edit category'}</h3>
            <form onSubmit={saveCategory} className="space-y-4">
              <div><label className="label">Name</label><input className="input" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} required /></div>
              <div><label className="label">Type</label><select className="input" value={categoryForm.type} onChange={(e) => setCategoryForm({ ...categoryForm, type: e.target.value })}><option value="variable">Variable</option><option value="fixed">Fixed</option></select></div>
              <div className="flex gap-3"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setCategoryModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

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
    </div>
  );
}
