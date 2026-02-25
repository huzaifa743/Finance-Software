import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, DollarSign, FileDown, BookOpen, Printer, Search } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf, buildPrintDocumentHtml } from '../utils/printHeader';

export default function Staff() {
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [salaryModal, setSalaryModal] = useState(null);
  const [slipModal, setSlipModal] = useState(null);
  const [slipRecords, setSlipRecords] = useState([]);
  const [slipLoading, setSlipLoading] = useState(false);
  const [form, setForm] = useState({ name: '', branch_id: '', fixed_salary: 0, commission_rate: 0, contact: '', joined_date: '' });
  const [salaryForm, setSalaryForm] = useState({ staff_id: '', month_year: '', base_salary: '', commission: 0, advances: 0, deductions: 0 });
  const [ledgerStaff, setLedgerStaff] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [staffQuery, setStaffQuery] = useState('');

  const load = () => api.get('/staff').then(setList).catch((e) => setErr(e.message));

  useEffect(() => { load(); api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ name: '', branch_id: branches[0]?.id || '', fixed_salary: 0, commission_rate: 0, contact: '', joined_date: '' });
    setModal('add');
  };

  const openEdit = (s) => {
    setForm({ id: s.id, name: s.name, branch_id: s.branch_id || '', fixed_salary: s.fixed_salary ?? 0, commission_rate: s.commission_rate ?? 0, contact: s.contact || '', joined_date: s.joined_date || '' });
    setModal('edit');
  };

  const openSalary = (s) => {
    const m = new Date();
    const my = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    setSalaryForm({ staff_id: s.id, month_year: my, base_salary: s.fixed_salary ?? '', commission: 0, advances: 0, deductions: 0 });
    setSalaryModal(s);
  };

  const openSlips = async (s) => {
    setSlipModal(s);
    setSlipRecords([]);
    setSlipLoading(true);
    try {
      const d = await api.get(`/staff/${s.id}`);
      setSlipRecords(d.salary_records || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSlipLoading(false);
    }
  };

  const downloadSlip = async (recordId, format) => {
    setErr('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/staff/salary/${recordId}/slip?format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || res.statusText || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salary-slip-${recordId}-${format}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/staff', { ...form, branch_id: form.branch_id || null });
      else await api.patch(`/staff/${form.id}`, form);
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const processSalary = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post(`/staff/${salaryForm.staff_id}/salary`, salaryForm);
      setSalaryModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const net = () => (Number(salaryForm.base_salary) || 0) + (Number(salaryForm.commission) || 0) - (Number(salaryForm.advances) || 0) - (Number(salaryForm.deductions) || 0);

  const openLedger = async (s) => {
    setLedgerStaff(s);
    setLedger(null);
    setLedgerLoading(true);
    setErr('');
    try {
      const d = await api.get(`/staff/${s.id}/ledger`);
      setLedger(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const downloadLedger = async (format) => {
    if (!ledgerStaff) return;
    setErr('');
    try {
      if (format === 'pdf' && ledger) {
        const company = await getCompanyForPrint();
        const headerHtml = buildPrintHeaderHtml(company, 'Staff Ledger', ledgerStaff.name, { forPdf: true });
        const salaries = ledger.salaries || [];
        const payments = ledger.payments || [];
        const body = `
          <p class="summary-line">Total salary: <strong>${fmt(ledger.totalSalary)}</strong> &nbsp;|&nbsp; Total paid: <strong>${fmt(ledger.totalPaid)}</strong> &nbsp;|&nbsp; Pending: <strong>${fmt(ledger.pending)}</strong></p>
          <h2>Salaries</h2>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th class="text-right">Base</th>
                <th class="text-right">Commission</th>
                <th class="text-right">Advances</th>
                <th class="text-right">Deductions</th>
                <th class="text-right">Net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${salaries.map(r => `
                <tr>
                  <td>${r.month_year}</td>
                  <td class="text-right font-mono">${fmt(r.base_salary)}</td>
                  <td class="text-right font-mono">${fmt(r.commission)}</td>
                  <td class="text-right font-mono">${fmt(r.advances)}</td>
                  <td class="text-right font-mono">${fmt(r.deductions)}</td>
                  <td class="text-right font-mono">${fmt(r.net_salary)}</td>
                  <td>${r.status}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <h2>Payments</h2>
          <table>
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Month</th>
                <th>Mode</th>
                <th class="text-right">Amount</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>${p.payment_date}</td>
                  <td>${p.month_year}</td>
                  <td>${p.mode}</td>
                  <td class="text-right font-mono">${fmt(p.amount)}</td>
                  <td>${p.remarks || '–'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        const fullHtml = buildPrintDocumentHtml(headerHtml, body, `Staff Ledger - ${ledgerStaff.name}`);
        await exportPrintAsPdf(fullHtml, `staff-ledger-${ledgerStaff.name || ledgerStaff.id}.pdf`);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/staff/${ledgerStaff.id}/ledger/export?type=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || res.statusText || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'xlsx' ? 'xlsx' : 'pdf';
      a.href = url;
      a.download = `staff-ledger-${ledgerStaff.name || ledgerStaff.id}.${ext}`.replace(/\s+/g, '-');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const printLedger = async () => {
    if (!ledgerStaff || !ledger) return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(company, 'Staff Ledger', ledgerStaff.name);
      const salaries = ledger.salaries || [];
      const payments = ledger.payments || [];
      const body = `
          <p class="summary-line">Total salary: <strong>${fmt(ledger.totalSalary)}</strong> &nbsp;|&nbsp; Total paid: <strong>${fmt(ledger.totalPaid)}</strong> &nbsp;|&nbsp; Pending: <strong>${fmt(ledger.pending)}</strong></p>
          <h2>Salaries</h2>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th class="text-right">Base</th>
                <th class="text-right">Commission</th>
                <th class="text-right">Advances</th>
                <th class="text-right">Deductions</th>
                <th class="text-right">Net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${salaries.map(r => `
                <tr>
                  <td>${r.month_year}</td>
                  <td class="text-right font-mono">${fmt(r.base_salary)}</td>
                  <td class="text-right font-mono">${fmt(r.commission)}</td>
                  <td class="text-right font-mono">${fmt(r.advances)}</td>
                  <td class="text-right font-mono">${fmt(r.deductions)}</td>
                  <td class="text-right font-mono">${fmt(r.net_salary)}</td>
                  <td>${r.status}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <h2>Payments</h2>
          <table>
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Month</th>
                <th>Mode</th>
                <th class="text-right">Amount</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${payments.map(p => `
                <tr>
                  <td>${p.payment_date}</td>
                  <td>${p.month_year}</td>
                  <td>${p.mode}</td>
                  <td class="text-right font-mono">${fmt(p.amount)}</td>
                  <td>${p.remarks || '–'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      const html = buildPrintDocumentHtml(headerHtml, body, `Staff Ledger - ${ledgerStaff.name}`);
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      win.close();
    }
  };

  const normalize = (v) => String(v || '').toLowerCase();
  const staffNeedle = staffQuery.trim().toLowerCase();
  const filteredStaff = staffNeedle
    ? list.filter((s) => {
        const hay = [
          s.name,
          s.branch_name,
          s.contact,
        ].map(normalize).join(' ');
        return hay.includes(staffNeedle);
      })
    : list;
  const ledgerNeedle = ledgerQuery.trim().toLowerCase();
  const filteredSalaries = ledger
    ? (ledgerNeedle
        ? (ledger.salaries || []).filter((r) => {
            const hay = [
              r.month_year,
              r.net_salary,
              r.status,
            ].map(normalize).join(' ');
            return hay.includes(ledgerNeedle);
          })
        : (ledger.salaries || []))
    : [];
  const filteredPayments = ledger
    ? (ledgerNeedle
        ? (ledger.payments || []).filter((p) => {
            const hay = [
              p.payment_date,
              p.month_year,
              p.mode,
              p.amount,
              p.remarks,
            ].map(normalize).join(' ');
            return hay.includes(ledgerNeedle);
          })
        : (ledger.payments || []))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Staff Salary & Commission</h1>
          <p className="text-slate-500 mt-1">Branch-wise staff, fixed salary, commission, advances, salary processing</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Staff</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4 mb-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <Search className="w-4 h-4 text-slate-500" />
            <span>Search staff</span>
          </div>
          <input
            className="input w-full md:w-[360px]"
            placeholder="Search by name, branch, contact"
            value={staffQuery}
            onChange={(e) => setStaffQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Fixed Salary</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Commission %</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Contact</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStaff.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">{s.branch_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(s.fixed_salary)}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.commission_rate}%</td>
                  <td className="px-4 py-3">{s.contact || '–'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openSalary(s)} className="btn-primary text-xs mr-1">Process Salary</button>
                    <button onClick={() => openSlips(s)} className="btn-secondary text-xs mr-1">Salary Slips</button>
                    <button onClick={() => openLedger(s)} className="btn-secondary text-xs mr-1 inline-flex items-center gap-1">
                      <BookOpen className="w-3 h-3" /> Ledger
                    </button>
                    <button onClick={() => openEdit(s)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredStaff.length && !loading && <p className="p-8 text-center text-slate-500">No staff.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Staff' : 'Edit Staff'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Fixed Salary</label><input type="number" step="0.01" className="input" value={form.fixed_salary} onChange={(e) => setForm({ ...form, fixed_salary: e.target.value })} /></div>
                <div><label className="label">Commission %</label><input type="number" step="0.01" className="input" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} /></div>
              </div>
              <div><label className="label">Contact</label><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              <div><label className="label">Joined Date</label><input type="date" className="input" value={form.joined_date} onChange={(e) => setForm({ ...form, joined_date: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {salaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Process Salary — {salaryModal.name}</h2>
            <form onSubmit={processSalary} className="space-y-4">
              <div><label className="label">Month (YYYY-MM) *</label><input className="input" value={salaryForm.month_year} onChange={(e) => setSalaryForm({ ...salaryForm, month_year: e.target.value })} placeholder="2025-01" required /></div>
              <div><label className="label">Base Salary</label><input type="number" step="0.01" className="input" value={salaryForm.base_salary} onChange={(e) => setSalaryForm({ ...salaryForm, base_salary: e.target.value })} /></div>
              <div><label className="label">Commission</label><input type="number" step="0.01" className="input" value={salaryForm.commission} onChange={(e) => setSalaryForm({ ...salaryForm, commission: e.target.value })} /></div>
              <div><label className="label">Advances</label><input type="number" step="0.01" className="input" value={salaryForm.advances} onChange={(e) => setSalaryForm({ ...salaryForm, advances: e.target.value })} /></div>
              <div><label className="label">Deductions</label><input type="number" step="0.01" className="input" value={salaryForm.deductions} onChange={(e) => setSalaryForm({ ...salaryForm, deductions: e.target.value })} /></div>
              <p className="text-sm font-medium">Net: {fmt(net())}</p>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Process</button><button type="button" onClick={() => setSalaryModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {slipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Salary Slips — {slipModal.name}</h2>
            {slipLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : slipRecords.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2">Month</th>
                      <th className="text-right px-3 py-2">Net</th>
                      <th className="text-right px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {slipRecords.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">{r.month_year}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmt(r.net_salary)}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => downloadSlip(r.id, 'a4')} className="btn-secondary text-xs mr-1"><FileDown className="w-3 h-3" /> A4</button>
                          <button onClick={() => downloadSlip(r.id, 'thermal')} className="btn-secondary text-xs"><FileDown className="w-3 h-3" /> Thermal</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No salary records yet.</p>
            )}
            <button type="button" onClick={() => { setSlipModal(null); setSlipRecords([]); }} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}

      {ledgerStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-5xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Ledger — {ledgerStaff.name}</h2>
                {ledger && (
                  <p className="text-sm text-slate-600">
                    Total salary: {fmt(ledger.totalSalary)} • Total paid: {fmt(ledger.totalPaid)} • Pending: {fmt(ledger.pending)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadLedger('pdf')}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                  disabled={ledgerLoading || !ledger}
                >
                  <FileDown className="w-3 h-3" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadLedger('xlsx')}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                  disabled={ledgerLoading || !ledger}
                >
                  <FileDown className="w-3 h-3" /> Excel
                </button>
                <button
                  type="button"
                  onClick={printLedger}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                  disabled={ledgerLoading || !ledger}
                >
                  <Printer className="w-3 h-3" /> Print
                </button>
                <button
                  type="button"
                  onClick={() => { setLedgerStaff(null); setLedger(null); setLedgerQuery(''); }}
                  className="btn-secondary text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {ledgerLoading && <p className="mt-4 text-sm text-slate-500">Loading ledger…</p>}

            {ledger && (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Search className="w-4 h-4 text-slate-500" />
                    <span>Search</span>
                  </div>
                  <input
                    className="input w-full md:w-[520px]"
                    placeholder="Search ledger by month, amount, status, remarks"
                    value={ledgerQuery}
                    onChange={(e) => setLedgerQuery(e.target.value)}
                  />
                </div>

                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2">Month</th>
                        <th className="text-right px-3 py-2">Base</th>
                        <th className="text-right px-3 py-2">Commission</th>
                        <th className="text-right px-3 py-2">Advances</th>
                        <th className="text-right px-3 py-2">Deductions</th>
                        <th className="text-right px-3 py-2">Net</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredSalaries.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2">{r.month_year}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.base_salary)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.commission)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.advances)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.deductions)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(r.net_salary)}</td>
                          <td className="px-3 py-2">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredSalaries.length && <p className="p-3 text-sm text-slate-500">No salary records found.</p>}
                </div>

                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2">Payment Date</th>
                        <th className="text-left px-3 py-2">Month</th>
                        <th className="text-left px-3 py-2">Mode</th>
                        <th className="text-right px-3 py-2">Amount</th>
                        <th className="text-left px-3 py-2">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2">{p.payment_date}</td>
                          <td className="px-3 py-2">{p.month_year}</td>
                          <td className="px-3 py-2">{p.mode}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(p.amount)}</td>
                          <td className="px-3 py-2">{p.remarks || '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredPayments.length && <p className="p-3 text-sm text-slate-500">No salary payments found.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
