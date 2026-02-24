import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, AlertTriangle, FileText, Printer, FileDown, X, Search } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf } from '../utils/printHeader';

export default function Receivables() {
  const [list, setList] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [recoverModal, setRecoverModal] = useState(null);
  const [form, setForm] = useState({ customer_id: '', branch_id: '', amount: '', due_date: '' });
  const [recoverForm, setRecoverForm] = useState({ receivable_id: '', amount: '', remarks: '' });
  const [ledgerPrintCustomer, setLedgerPrintCustomer] = useState(null);
  const [ledgerModal, setLedgerModal] = useState(null);
  const [ledgerData, setLedgerData] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [query, setQuery] = useState('');

  const load = () => {
    api.get('/receivables').then(setList).catch((e) => setErr(e.message));
    api.get('/receivables/overdue').then(setOverdue).catch(() => {});
  };

  const loadCustomers = () => api.get('/receivables/customers').then(setCustomers).catch(() => {});

  useEffect(() => {
    load();
    loadCustomers();
    api.get('/branches?active=1').then(setBranches).catch(() => {});
  }, []);

  useEffect(() => { setLoading(false); }, [list]);

  const openAdd = () => {
    setForm({ customer_id: customers[0]?.id || '', branch_id: branches[0]?.id || '', amount: '', due_date: '' });
    setModal('add');
  };

  const openRecover = (r) => {
    setRecoverForm({ receivable_id: r.id, amount: '', remarks: '' });
    setRecoverModal(r);
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/receivables', { ...form, amount: form.amount, customer_id: form.customer_id, branch_id: form.branch_id || null, due_date: form.due_date || null });
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
      await api.post(`/receivables/${recoverForm.receivable_id}/recover`, { amount: recoverForm.amount, remarks: recoverForm.remarks });
      setRecoverModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openLedgerPdf = async (customerId, customerName) => {
    setErr('');
    setLedgerModal({ customerId, customerName });
    setLedgerData(null);
    setLedgerLoading(true);
    try {
      const d = await api.get(`/receivables/ledger/${customerId}`);
      setLedgerData(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLedgerLoading(false);
    }
  };

  const exportLedger = async (customerId, type) => {
    setErr('');
    try {
      if (type === 'pdf' && ledgerData && ledgerModal?.customerId === customerId) {
        const company = await getCompanyForPrint();
        const headerHtml = buildPrintHeaderHtml(company, 'Receivables Ledger', `Customer: ${ledgerModal.customerName || 'Customer'}`, { forPdf: true });
        const customer = ledgerData.customer || {};
        const body = `
        <p><strong>${customer.name || '–'}</strong></p>
        ${customer.contact ? `<p>Contact: ${customer.contact}</p>` : ''}
        ${customer.address ? `<p>Address: ${customer.address}</p>` : ''}
        <p>Total due: ${fmt(ledgerData.totalDue)} | Total recovered: ${fmt(ledgerData.recoveredTotal)}</p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${(ledgerData.entries || []).map(e => `
              <tr>
                <td>${e.date || '–'}</td>
                <td>${e.description || '–'}</td>
                <td style="text-align:right;">${e.credit ? fmt(e.credit) : '–'}</td>
                <td style="text-align:right;">${e.debit ? fmt(e.debit) : '–'}</td>
                <td style="text-align:right;">${fmt(e.balance ?? 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
        const fullHtml = `
        <html>
          <head>
            <title>Receivables Ledger - ${ledgerModal.customerName || 'Customer'}</title>
            <style>
              body { font-family: system-ui, sans-serif; padding: 16px; }
              h1, h2 { margin: 12px 0 8px; }
              table { border-collapse: collapse; width: 100%; margin-top: 8px; }
              th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; }
              th { background: #f3f4f6; }
            </style>
          </head>
          <body>
            ${headerHtml}
            ${body}
          </body>
        </html>
      `;
        await exportPrintAsPdf(fullHtml, `receivable-ledger-${ledgerModal.customerName || customerId}.pdf`);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/receivables/ledger/${customerId}/export?type=${type}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || res.statusText || 'Export failed');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `receivable-ledger-${customerId}.${type === 'xlsx' ? 'xlsx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    }
  };

  const printLedger = async () => {
    if (!ledgerModal || !ledgerData) return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(company, 'Receivables Ledger', `Customer: ${ledgerModal.customerName || 'Customer'}`);
      const customer = ledgerData.customer || {};
      const body = `
        <p><strong>${customer.name || '–'}</strong></p>
        ${customer.contact ? `<p>Contact: ${customer.contact}</p>` : ''}
        ${customer.address ? `<p>Address: ${customer.address}</p>` : ''}
        <p>Total due: ${fmt(ledgerData.totalDue)} | Total recovered: ${fmt(ledgerData.recoveredTotal)}</p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${(ledgerData.entries || []).map(e => `
              <tr>
                <td>${e.date || '–'}</td>
                <td>${e.description || '–'}</td>
                <td style="text-align:right;">${e.credit ? fmt(e.credit) : '–'}</td>
                <td style="text-align:right;">${e.debit ? fmt(e.debit) : '–'}</td>
                <td style="text-align:right;">${fmt(e.balance ?? 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      const html = `
        <html>
          <head>
            <title>Receivables Ledger - ${ledgerModal.customerName || 'Customer'}</title>
            <style>
              body { font-family: system-ui, sans-serif; padding: 16px; }
              h1, h2 { margin: 12px 0 8px; }
              table { border-collapse: collapse; width: 100%; margin-top: 8px; }
              th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; }
              th { background: #f3f4f6; }
            </style>
          </head>
          <body>
            ${headerHtml}
            ${body}
          </body>
        </html>
      `;
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      win.close();
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const normalize = (v) => String(v || '').toLowerCase();
  const needle = query.trim().toLowerCase();
  const filteredList = needle
    ? list.filter((r) => {
        const hay = [
          r.customer_name,
          r.branch_name,
          r.status,
          r.due_date,
          r.amount,
        ].map(normalize).join(' ');
        return hay.includes(needle);
      })
    : list;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receivables (Credit Sales)</h1>
          <p className="text-slate-500 mt-1">Customer ledger, recovery, overdue alerts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLedgerPrintCustomer(true)} className="btn-secondary"><FileText className="w-4 h-4" /> Ledger (select customer)</button>
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Receivable</button>
        </div>
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
            placeholder="Search by customer, branch, status, due date, amount"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <h3 className="font-medium text-amber-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Overdue ({overdue.length})</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="text-left">Customer</th><th className="text-left">Branch</th><th className="text-right">Amount</th><th className="text-left">Due</th><th className="text-right">Action</th></tr></thead>
              <tbody>
                {overdue.map((r) => (
                  <tr key={r.id}><td>{r.customer_name}</td><td>{r.branch_name}</td><td className="text-right font-mono">{fmt(r.amount)}</td><td>{r.due_date}</td>
                    <td className="text-right"><button onClick={() => openRecover(r)} className="btn-primary text-xs">Recover</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Branch</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Due Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Status</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredList.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{r.customer_name || '–'}</td>
                  <td className="px-4 py-3">{r.branch_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(r.amount)}</td>
                  <td className="px-4 py-3">{r.due_date || '–'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'partial' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openLedgerPdf(r.customer_id, r.customer_name)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-primary-600 mr-2" title="View ledger"><FileText className="w-3.5 h-3.5" /> Ledger</button>
                    {r.status !== 'recovered' && <button onClick={() => openRecover(r)} className="btn-primary text-xs">Recover</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredList.length && !loading && <p className="p-8 text-center text-slate-500">No receivables.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Receivable</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Customer *</label><select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label">Branch</label><select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">–</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
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
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Recover — {recoverModal.customer_name} ({fmt(recoverModal.amount)} due)</h2>
            <form onSubmit={recover} className="space-y-4">
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={recoverForm.amount} onChange={(e) => setRecoverForm({ ...recoverForm, amount: e.target.value })} required /></div>
              <div><label className="label">Remarks</label><input className="input" value={recoverForm.remarks} onChange={(e) => setRecoverForm({ ...recoverForm, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Recover</button><button type="button" onClick={() => setRecoverModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {ledgerPrintCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Print Receivables Ledger</h2>
            <p className="text-sm text-slate-600 mb-4">Select a customer to open their ledger in a window. You can then export PDF/Excel or print.</p>
            <select
              className="input w-full mb-4"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  const c = customers.find((x) => String(x.id) === id);
                  openLedgerPdf(id, c?.name);
                  setLedgerPrintCustomer(null);
                }
              }}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button type="button" onClick={() => setLedgerPrintCustomer(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {ledgerModal && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-xl font-semibold text-slate-900">Receivables Ledger — {ledgerModal.customerName || 'Customer'}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => exportLedger(ledgerModal.customerId, 'xlsx')} className="btn-secondary"><FileDown className="w-4 h-4" /> Excel</button>
              <button onClick={() => exportLedger(ledgerModal.customerId, 'pdf')} className="btn-secondary"><FileDown className="w-4 h-4" /> PDF</button>
              <button onClick={printLedger} className="btn-secondary"><Printer className="w-4 h-4" /> Print</button>
              <button onClick={() => { setLedgerModal(null); setLedgerData(null); }} className="btn-secondary"><X className="w-4 h-4" /> Close</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6 print:block">
            {ledgerLoading && <p className="text-slate-500">Loading ledger…</p>}
            {ledgerData && !ledgerLoading && (
              <>
                {ledgerData.customer && (
                  <div className="mb-4 p-4 bg-slate-50 rounded-lg">
                    <p className="font-semibold text-slate-900">{ledgerData.customer.name}</p>
                    {ledgerData.customer.contact && <p className="text-sm text-slate-600">Contact: {ledgerData.customer.contact}</p>}
                    {ledgerData.customer.address && <p className="text-sm text-slate-600">Address: {ledgerData.customer.address}</p>}
                    <p className="mt-2 text-sm font-medium text-primary-700">Total due: {fmt(ledgerData.totalDue)}</p>
                    <p className="text-sm text-slate-600">Total recovered: {fmt(ledgerData.recoveredTotal)}</p>
                  </div>
                )}
                <h3 className="font-semibold text-slate-800 mt-4 mb-2">Credit entries (Receivables)</h3>
                <table className="w-full text-sm border border-slate-200 mb-6">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Date</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Branch</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-700">Amount</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Status</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Due Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(ledgerData.receivables || []).map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">{(r.created_at || '').slice(0, 10)}</td>
                        <td className="px-4 py-2">{r.branch_name || '–'}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(r.amount)}</td>
                        <td className="px-4 py-2">{r.status || '–'}</td>
                        <td className="px-4 py-2">{r.due_date || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!ledgerData.receivables || !ledgerData.receivables.length) && <p className="text-slate-500 mb-6">No receivables entries.</p>}
                <h3 className="font-semibold text-slate-800 mt-4 mb-2">Recoveries</h3>
                <table className="w-full text-sm border border-slate-200">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Date</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-700">Amount</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(ledgerData.recoveries || []).map((rr) => (
                      <tr key={rr.id}>
                        <td className="px-4 py-2">{(rr.recovered_at || '').slice(0, 10)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(rr.amount)}</td>
                        <td className="px-4 py-2">{rr.remarks || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!ledgerData.recoveries || !ledgerData.recoveries.length) && <p className="text-slate-500">No recoveries yet.</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
