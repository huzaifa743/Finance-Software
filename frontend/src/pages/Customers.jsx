import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, BookOpen, Wallet, FileDown, Printer, Search, X } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf } from '../utils/printHeader';

export default function Customers() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', address: '' });
  const [recoverModal, setRecoverModal] = useState(null);
  const [recoverForm, setRecoverForm] = useState({ receivable_id: '', amount: '', remarks: '' });
  const [openReceivables, setOpenReceivables] = useState([]);
  const [query, setQuery] = useState('');
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [ledgerQuery, setLedgerQuery] = useState('');

  const load = () => api.get('/receivables/customers/with-balance').then(setList).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);
  useEffect(() => { setLoading(false); }, [list]);

  useEffect(() => {
    if (!ledgerCustomer) { setLedger(null); return; }
    api.get(`/receivables/ledger/${ledgerCustomer.id}`)
      .then(setLedger)
      .catch((e) => setErr(e.message));
  }, [ledgerCustomer]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', contact: '', address: '' });
    setModal('add');
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, contact: c.contact || '', address: c.address || '' });
    setModal('edit');
  };

  const saveCustomer = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/receivables/customers', form);
      else await api.patch(`/receivables/customers/${editing.id}`, form);
      setModal(null);
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openLedger = (c) => setLedgerCustomer(c);

  const openRecover = async (customer) => {
    setErr('');
    try {
      const recs = await api.get(`/receivables?customer_id=${customer.id}`);
      const open = (recs || []).filter((r) => r.status === 'pending' || r.status === 'partial');
      setOpenReceivables(open);
      setRecoverModal(customer);
      setRecoverForm({ receivable_id: open[0]?.id || '', amount: '', remarks: '' });
    } catch (e) {
      setErr(e.message);
    }
  };

  const recover = async (e) => {
    e.preventDefault();
    setErr('');
    if (!recoverForm.receivable_id) {
      setErr('Select a receivable.');
      return;
    }
    try {
      await api.post(`/receivables/${recoverForm.receivable_id}/recover`, {
        amount: recoverForm.amount,
        remarks: recoverForm.remarks,
      });
      setRecoverModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const normalize = (v) => String(v || '').toLowerCase();
  const needle = query.trim().toLowerCase();
  const filteredList = needle
    ? list.filter((c) => {
        const hay = [c.name, c.contact, c.address].map(normalize).join(' ');
        return hay.includes(needle);
      })
    : list;
  const totalPendingAll = list.reduce((sum, c) => sum + (Number(c.total_due) || 0), 0);

  const ledgerNeedle = ledgerQuery.trim().toLowerCase();
  const filteredEntries = ledgerNeedle && ledger?.entries
    ? ledger.entries.filter((e) => {
        const hay = [e.date, e.description, e.credit, e.debit, e.balance].map(normalize).join(' ');
        return hay.includes(ledgerNeedle);
      })
    : (ledger?.entries || []);
  const filteredReceivables = ledgerNeedle && ledger
    ? (ledger.receivables || []).filter((r) => {
        const hay = [r.created_at, r.branch_name, r.amount, r.status, r.due_date].map(normalize).join(' ');
        return hay.includes(ledgerNeedle);
      })
    : (ledger?.receivables || []);
  const filteredRecoveries = ledgerNeedle && ledger
    ? (ledger.recoveries || []).filter((rr) => {
        const hay = [rr.recovered_at, rr.amount, rr.remarks].map(normalize).join(' ');
        return hay.includes(ledgerNeedle);
      })
    : (ledger?.recoveries || []);

  const downloadLedger = async (format) => {
    if (!ledgerCustomer) return;
    setErr('');
    try {
      if (format === 'pdf') {
        const company = await getCompanyForPrint();
        const headerHtml = buildPrintHeaderHtml(company, 'Receivables Ledger', `Customer: ${ledgerCustomer.name || 'Customer'}`, { forPdf: true });
        const customer = ledger?.customer || {};
        const body = `
        <p><strong>${customer.name || '–'}</strong></p>
        ${customer.contact ? `<p>Contact: ${customer.contact}</p>` : ''}
        ${customer.address ? `<p>Address: ${customer.address}</p>` : ''}
        <p>Total due: ${fmt(ledger?.totalDue ?? 0)} | Total recovered: ${fmt(ledger?.recoveredTotal ?? 0)}</p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${(ledger?.entries || []).map(e => `
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
            <title>Receivables Ledger - ${ledgerCustomer.name}</title>
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
        await exportPrintAsPdf(fullHtml, `receivable-ledger-${ledgerCustomer.name || ledgerCustomer.id}.pdf`);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/receivables/ledger/${ledgerCustomer.id}/export?type=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || res.statusText || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receivable-ledger-${ledgerCustomer.name || ledgerCustomer.id}.xlsx`.replace(/\s+/g, '-');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const printLedger = async () => {
    if (!ledgerCustomer || !ledger) return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(company, 'Receivables Ledger', `Customer: ${ledgerCustomer.name || 'Customer'}`);
      const customer = ledger.customer || {};
      const body = `
        <p><strong>${customer.name || '–'}</strong></p>
        ${customer.contact ? `<p>Contact: ${customer.contact}</p>` : ''}
        ${customer.address ? `<p>Address: ${customer.address}</p>` : ''}
        <p>Total due: ${fmt(ledger.totalDue)} | Total recovered: ${fmt(ledger.recoveredTotal)}</p>
        <h2>Ledger (Credit / Debit / Balance)</h2>
        <table>
          <thead><tr><th>Date</th><th>Description</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Balance</th></tr></thead>
          <tbody>
            ${(ledger.entries || []).map(e => `
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
            <title>Receivables Ledger - ${ledgerCustomer.name}</title>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-slate-500 mt-1">Manage customers, view ledger, and receive balance.</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Customer</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-slate-700">Search</span>
            <input
              className="input w-full md:w-[360px]"
              placeholder="Search by name, phone, address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-600">Total pending balance (all customers)</p>
          <p className="mt-1 text-2xl font-bold text-primary-700 font-mono">{fmt(totalPendingAll)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Address</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Balance (due)</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredList.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.contact || 'N/A'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.address || 'N/A'}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{fmt(c.total_due)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openLedger(c)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-primary-600 mr-2" title="Ledger"><BookOpen className="w-3.5 h-3.5" /> Ledger</button>
                    {(Number(c.total_due) || 0) > 0 && (
                      <button onClick={() => openRecover(c)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-primary-600 mr-2" title="Receive"><Wallet className="w-3.5 h-3.5" /> Receive</button>
                    )}
                    <button onClick={() => openEdit(c)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredList.length && !loading && <p className="p-8 text-center text-slate-500">No customers. Add one to get started.</p>}
      </div>

      {ledgerCustomer && ledger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-5xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Ledger — {ledgerCustomer.name}</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Total due: {fmt(ledger.totalDue)} • Total recovered: {fmt(ledger.recoveredTotal)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => downloadLedger('pdf')} className="btn-secondary text-xs inline-flex items-center gap-1">
                  <FileDown className="w-3 h-3" /> PDF
                </button>
                <button type="button" onClick={() => downloadLedger('xlsx')} className="btn-secondary text-xs inline-flex items-center gap-1">
                  <FileDown className="w-3 h-3" /> Excel
                </button>
                <button type="button" onClick={printLedger} className="btn-secondary text-xs inline-flex items-center gap-1">
                  <Printer className="w-3 h-3" /> Print
                </button>
                <button onClick={() => { setLedgerCustomer(null); setLedger(null); }} className="btn-secondary text-xs">
                  Close
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <Search className="w-4 h-4 text-slate-500" />
                <span>Search</span>
              </div>
              <input
                className="input w-full md:w-[520px]"
                placeholder="Search ledger by date, description, credit, debit, balance"
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
              />
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Credit</th>
                    <th className="text-right px-3 py-2">Debit</th>
                    <th className="text-right px-3 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredEntries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2">{e.date || '–'}</td>
                      <td className="px-3 py-2">{e.description || '–'}</td>
                      <td className="px-3 py-2 text-right font-mono">{e.credit ? fmt(e.credit) : '–'}</td>
                      <td className="px-3 py-2 text-right font-mono">{e.debit ? fmt(e.debit) : '–'}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{fmt(e.balance ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredEntries.length && <p className="p-3 text-sm text-slate-500">No ledger entries.</p>}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Customer' : 'Edit Customer'}</h2>
            <form onSubmit={saveCustomer} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Contact</label><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => { setModal(null); setEditing(null); }} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {recoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Receive — {recoverModal.name} (Balance: {fmt(recoverModal.total_due)})</h2>
            <form onSubmit={recover} className="space-y-4">
              <div>
                <label className="label">Receivable *</label>
                <select className="input w-full" value={recoverForm.receivable_id} onChange={(e) => setRecoverForm({ ...recoverForm, receivable_id: e.target.value })} required>
                  <option value="">Select…</option>
                  {openReceivables.map((r) => (
                    <option key={r.id} value={r.id}>{r.branch_name || '–'} — Due: {fmt(r.amount)} ({r.due_date || '–'})</option>
                  ))}
                </select>
              </div>
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={recoverForm.amount} onChange={(e) => setRecoverForm({ ...recoverForm, amount: e.target.value })} required /></div>
              <div><label className="label">Remarks</label><input className="input" value={recoverForm.remarks} onChange={(e) => setRecoverForm({ ...recoverForm, remarks: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Receive</button><button type="button" onClick={() => setRecoverModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
