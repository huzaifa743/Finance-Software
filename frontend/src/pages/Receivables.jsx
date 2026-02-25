import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, AlertTriangle, FileText, X, Search, FileDown, Printer } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf, buildPrintDocumentHtml } from '../utils/printHeader';

export default function Receivables() {
  const [list, setList] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [branches, setBranches] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [recoverModal, setRecoverModal] = useState(null);
  const [form, setForm] = useState({ branch_id: '', amount: '', due_date: '' });
  const [recoverForm, setRecoverForm] = useState({ receivable_id: '', amount: '', remarks: '', payment_method: 'cash' });
  const [query, setQuery] = useState('');
  const [branchLedger, setBranchLedger] = useState([]);
  const [branchLedgerModal, setBranchLedgerModal] = useState(null);
  const [branchLedgerData, setBranchLedgerData] = useState(null);
  const [branchLedgerLoading, setBranchLedgerLoading] = useState(false);
  const [branchRecoverModal, setBranchRecoverModal] = useState(null);
  const [branchRecoverForm, setBranchRecoverForm] = useState({
    branch_id: '',
    receivable_id: '',
    amount: '',
    payment_method: 'cash',
    payment_date: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [branchReceivables, setBranchReceivables] = useState([]);

  const load = () => {
    api.get('/receivables').then(setList).catch((e) => setErr(e.message));
    api.get('/receivables/overdue').then(setOverdue).catch(() => {});
    api.get('/receivables/branch-ledger').then(setBranchLedger).catch(() => {});
  };

  useEffect(() => {
    load();
    api.get('/branches?active=1').then(setBranches).catch(() => {});
    api.get('/banks').then(setBanks).catch(() => {});
  }, []);

  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ branch_id: branches[0]?.id || '', amount: '', due_date: '' });
    setModal('add');
  };

  const openRecover = (r) => {
    setRecoverForm({
      receivable_id: r.id,
      amount: '',
      remarks: '',
      payment_method: 'cash',
    });
    setRecoverModal(r);
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/receivables', { ...form, amount: form.amount, customer_id: null, branch_id: form.branch_id || null, due_date: form.due_date || null });
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const recover = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/payments', {
        category: 'receivable_recovery',
        reference_id: recoverForm.receivable_id,
        amount: recoverForm.amount,
        payment_date: new Date().toISOString().slice(0, 10),
        payment_method: recoverForm.payment_method,
        remarks: recoverForm.remarks,
      });
      setRecoverModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openBranchLedger = async (branchId, branchName) => {
    setErr('');
    setBranchLedgerModal({ branchId, branchName });
    setBranchLedgerData(null);
    setBranchLedgerLoading(true);
    try {
      const d = await api.get(`/receivables/branch-ledger/${branchId}`);
      setBranchLedgerData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBranchLedgerLoading(false);
    }
  };

  const openBranchRecover = async (branchRow) => {
    setErr('');
    try {
      const recs = await api.get(`/receivables?branch_id=${branchRow.branch_id}`);
      const open = (recs || []).filter((r) => r.status === 'pending' || r.status === 'partial');
      setBranchReceivables(open);
      setBranchRecoverForm({
        branch_id: branchRow.branch_id,
        receivable_id: open[0]?.id || '',
        amount: '',
        payment_method: 'cash',
        payment_date: new Date().toISOString().slice(0, 10),
        remarks: '',
      });
      setBranchRecoverModal(branchRow);
    } catch (e) {
      setErr(e.message);
    }
  };

  const submitBranchRecover = async (e) => {
    e.preventDefault();
    setErr('');
    if (!branchRecoverForm.receivable_id) {
      setErr('Select an open receivable for this branch.');
      return;
    }
    try {
      await api.post('/payments', {
        category: 'receivable_recovery',
        reference_id: branchRecoverForm.receivable_id,
        amount: branchRecoverForm.amount,
        payment_date: branchRecoverForm.payment_date,
        payment_method: branchRecoverForm.payment_method,
        remarks: branchRecoverForm.remarks,
      });
      setBranchRecoverModal(null);
      setBranchReceivables([]);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const normalize = (v) => String(v || '').toLowerCase();
  const needle = query.trim().toLowerCase();
  const selectedBranchSummary = form.branch_id
    ? (branchLedger || []).find((r) => String(r.branch_id) === String(form.branch_id))
    : null;
  const filteredList = needle
    ? list.filter((r) => {
        const hay = [
          r.branch_name,
          r.status,
          r.due_date,
          r.amount,
        ].map(normalize).join(' ');
        return hay.includes(needle);
      })
    : list;

  const exportBranchLedgerCsv = () => {
    if (!branchLedgerModal || !branchLedgerData) return;
    const entries = branchLedgerData.entries || [];
    if (!entries.length) return;
    const header = ['Date', 'Description', 'Credit', 'Debit', 'Balance'];
    const rows = entries.map((e) => [
      e.date || '',
      e.description || '',
      e.credit || 0,
      e.debit || 0,
      e.balance ?? 0,
    ]);
    const csvLines = [
      header.join(','),
      ...rows.map((r) => r.map((v) => JSON.stringify(v ?? '')).join(',')),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `branch-receivables-ledger-${(branchLedgerModal?.branchName || branchLedgerModal?.branchId || 'branch')
      .toString()
      .replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBranchLedgerPdf = async () => {
    if (!branchLedgerModal || !branchLedgerData) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(
        company,
        'Branch Receivables Ledger',
        `Branch: ${branchLedgerModal.branchName || 'Branch'}`,
        { forPdf: true }
      );
      const entries = branchLedgerData.entries || [];
      const body = `
        <p class="summary-line">Total due: <strong>${fmt(branchLedgerData.totalDue ?? 0)}</strong> &nbsp;|&nbsp; Total recovered: <strong>${fmt(
        branchLedgerData.recoveredTotal ?? 0
      )}</strong></p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th class="text-right">Credit</th>
              <th class="text-right">Debit</th>
              <th class="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${entries
              .map(
                (e) => `
              <tr>
                <td>${e.date || '–'}</td>
                <td>${e.description || '–'}</td>
                <td class="text-right font-mono">${e.credit ? fmt(e.credit) : '–'}</td>
                <td class="text-right font-mono">${e.debit ? fmt(e.debit) : '–'}</td>
                <td class="text-right font-mono">${fmt(e.balance ?? 0)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      const fullHtml = buildPrintDocumentHtml(headerHtml, body, `Branch Receivables Ledger - ${branchLedgerModal.branchName || 'Branch'}`);
      await exportPrintAsPdf(
        fullHtml,
        `branch-receivables-ledger-${(branchLedgerModal.branchName || branchLedgerModal.branchId || 'branch')
          .toString()
          .replace(/\s+/g, '-')}.pdf`
      );
    } catch (e) {
      setErr(e.message);
    }
  };

  const printBranchLedger = async () => {
    if (!branchLedgerModal || !branchLedgerData) return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(
        company,
        'Branch Receivables Ledger',
        `Branch: ${branchLedgerModal.branchName || 'Branch'}`
      );
      const entries = branchLedgerData.entries || [];
      const body = `
        <p class="summary-line">Total due: <strong>${fmt(branchLedgerData.totalDue ?? 0)}</strong> &nbsp;|&nbsp; Total recovered: <strong>${fmt(
        branchLedgerData.recoveredTotal ?? 0
      )}</strong></p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th class="text-right">Credit</th>
              <th class="text-right">Debit</th>
              <th class="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${entries
              .map(
                (e) => `
              <tr>
                <td>${e.date || '–'}</td>
                <td>${e.description || '–'}</td>
                <td class="text-right font-mono">${e.credit ? fmt(e.credit) : '–'}</td>
                <td class="text-right font-mono">${e.debit ? fmt(e.debit) : '–'}</td>
                <td class="text-right font-mono">${fmt(e.balance ?? 0)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      const html = buildPrintDocumentHtml(headerHtml, body, `Branch Receivables Ledger - ${branchLedgerModal.branchName || 'Branch'}`);
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      win.close();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receivables (Credit Sales)</h1>
          <p className="text-slate-500 mt-1">Branch-wise receivables, recovery, overdue alerts</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Receivable</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <Search className="w-4 h-4 text-slate-500" />
            <span>Search</span>
          </div>
          <input
            className="input w-full md:w-[420px]"
            placeholder="Search by branch, status, due date, amount"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Branch-wise receivables summary (credit / received / pending) */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Branch-wise receivables</h2>
            <p className="text-xs text-slate-500">Credit sales, recoveries and pending balance per branch.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Branch</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Credit sales (total)</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Receivables (open)</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Received</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Pending balance</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(branchLedger || []).map((r) => (
                <tr key={r.branch_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">{r.branch_name || '–'}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.credit_sales)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.receivable_amount)}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.received_amount)}</td>
                  <td className="px-4 py-2 text-right font-mono font-medium">{fmt(r.pending_balance)}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button
                      onClick={() => openBranchLedger(r.branch_id, r.branch_name)}
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-primary-600"
                    >
                      <FileText className="w-3.5 h-3.5" /> Ledger
                    </button>
                    {Number(r.pending_balance) > 0 && (
                      <button
                        onClick={() => openBranchRecover(r)}
                        className="btn-primary text-xs"
                      >
                        Recover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!branchLedger?.length && (
            <p className="p-4 text-sm text-slate-500 text-center">No branch receivables yet.</p>
          )}
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="font-medium text-amber-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Overdue ({overdue.length})</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left">Branch</th><th className="text-right">Amount</th><th className="text-left">Due</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {overdue.map((r) => (
                  <tr key={r.id}><td>{r.branch_name}</td><td className="text-right font-mono">{fmt(r.amount)}</td><td>{r.due_date}</td>
                    <td className="text-right"><button onClick={() => openRecover(r)} className="btn-primary text-xs">Recover</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!filteredList.length && !loading && (
        <div className="card">
          <p className="p-8 text-center text-slate-500">No receivables.</p>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Receivable</h2>
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="label">Branch *</label>
                <select
                  className="input"
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  required
                >
                  <option value="">–</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {selectedBranchSummary && (
                  <p className="mt-1 text-xs text-slate-500">
                    Current pending balance for this branch:{' '}
                    <span className="font-semibold">
                      {fmt(selectedBranchSummary.pending_balance)}
                    </span>
                  </p>
                )}
              </div>
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
              <div><label className="label">Due Date</label><input type="date" className="input" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {recoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Recover — {recoverModal.branch_name || 'Branch'} ({fmt(recoverModal.amount)} due)
            </h2>
            <form onSubmit={recover} className="space-y-4">
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={recoverForm.amount} onChange={(e) => setRecoverForm({ ...recoverForm, amount: e.target.value })} required /></div>
              <div>
                <label className="label">Payment method</label>
                <select
                  className="input"
                  value={recoverForm.payment_method}
                  onChange={(e) => setRecoverForm({ ...recoverForm, payment_method: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.account_number ? ` (${b.account_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div><label className="label">Remarks</label><input className="input" value={recoverForm.remarks} onChange={(e) => setRecoverForm({ ...recoverForm, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Recover</button><button type="button" onClick={() => setRecoverModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {branchLedgerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-5xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Branch Receivables Ledger — {branchLedgerModal.branchName || 'Branch'}
                </h2>
                {branchLedgerData && (
                  <p className="text-sm text-slate-600 mt-1">
                    Total due: {fmt(branchLedgerData.totalDue ?? 0)} • Total recovered:{' '}
                    {fmt(branchLedgerData.recoveredTotal ?? 0)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadBranchLedgerPdf}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3" /> PDF
                </button>
                <button
                  type="button"
                  onClick={exportBranchLedgerCsv}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3" /> Excel/CSV
                </button>
                <button
                  type="button"
                  onClick={printBranchLedger}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <Printer className="w-3 h-3" /> Print
                </button>
                <button
                  onClick={() => {
                    setBranchLedgerModal(null);
                    setBranchLedgerData(null);
                  }}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <X className="w-4 h-4" /> Close
                </button>
              </div>
            </div>
            <div className="mt-4">
              {branchLedgerLoading && <p className="text-slate-500">Loading branch ledger…</p>}
              {branchLedgerData && !branchLedgerLoading && (
                <>
                  {branchLedgerData.branch && (
                    <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                      <p className="font-semibold text-slate-900">{branchLedgerData.branch.name}</p>
                    </div>
                  )}
                  <h3 className="font-semibold text-slate-800 mt-2 mb-2">Ledger (Credit / Debit / Balance)</h3>
                  <table className="w-full text-sm border border-slate-200 mb-6 bg-white">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-slate-700">Date</th>
                        <th className="text-left px-4 py-2 font-medium text-slate-700">Description</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-700">Credit</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-700">Debit</th>
                        <th className="text-right px-4 py-2 font-medium text-slate-700">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(branchLedgerData.entries || []).map((e) => (
                        <tr key={e.id}>
                          <td className="px-4 py-2">{e.date || '–'}</td>
                          <td className="px-4 py-2">{e.description || '–'}</td>
                          <td className="px-4 py-2 text-right font-mono">{e.credit ? fmt(e.credit) : '–'}</td>
                          <td className="px-4 py-2 text-right font-mono">{e.debit ? fmt(e.debit) : '–'}</td>
                          <td className="px-4 py-2 text-right font-mono font-medium">{fmt(e.balance ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(!branchLedgerData.entries || !branchLedgerData.entries.length) && (
                    <p className="text-slate-500 mb-6">No ledger entries yet.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {branchRecoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Recover — {branchRecoverModal.branch_name || 'Branch'} (Pending {fmt(branchRecoverModal.pending_balance)})
            </h2>
            <form onSubmit={submitBranchRecover} className="space-y-4">
              <div>
                <label className="label">Open receivable</label>
                <select
                  className="input w-full"
                  value={branchRecoverForm.receivable_id}
                  onChange={(e) => setBranchRecoverForm({ ...branchRecoverForm, receivable_id: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {branchReceivables.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.due_date || 'No due date')} — Due {fmt(r.amount)} ({r.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-full"
                  value={branchRecoverForm.amount}
                  onChange={(e) => setBranchRecoverForm({ ...branchRecoverForm, amount: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Payment date</label>
                <input
                  type="date"
                  className="input w-full"
                  value={branchRecoverForm.payment_date}
                  onChange={(e) => setBranchRecoverForm({ ...branchRecoverForm, payment_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Payment method</label>
                <select
                  className="input w-full"
                  value={branchRecoverForm.payment_method}
                  onChange={(e) => setBranchRecoverForm({ ...branchRecoverForm, payment_method: e.target.value })}
                >
                  <option value="cash">Cash</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.account_number ? ` (${b.account_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Remarks</label>
                <input
                  className="input w-full"
                  value={branchRecoverForm.remarks}
                  onChange={(e) => setBranchRecoverForm({ ...branchRecoverForm, remarks: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="btn-primary">Recover</button>
                <button
                  type="button"
                  onClick={() => {
                    setBranchRecoverModal(null);
                    setBranchReceivables([]);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
