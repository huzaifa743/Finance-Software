import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, BookOpen, Search, Trash2, FileDown, Printer, DollarSign } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf, buildPrintDocumentHtml } from '../utils/printHeader';

export default function Suppliers() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', vat_number: '', contact: '' });
  const [ledgerSupplier, setLedgerSupplier] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [payModalSupplier, setPayModalSupplier] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', remarks: '' });
  const [banks, setBanks] = useState([]);
  const [supplierBalances, setSupplierBalances] = useState({});
  const [totalPendingSuppliers, setTotalPendingSuppliers] = useState(0);

  const load = () => api.get('/purchases/suppliers').then(setList).catch((e) => setErr(e.message));

  const loadSupplierBalances = () =>
    api
      .get('/purchases/reports/supplier-wise')
      .then((rows) => {
        const map = {};
        let total = 0;
        (rows || []).forEach((r) => {
          const bal = Number(r.balance) || 0;
          map[r.id] = bal;
          if (bal > 0) total += bal;
        });
        setSupplierBalances(map);
        setTotalPendingSuppliers(total);
      })
      .catch(() => {
        setSupplierBalances({});
        setTotalPendingSuppliers(0);
      });

  useEffect(() => {
    load();
    loadSupplierBalances();
    api.get('/banks').then(setBanks).catch(() => {});
  }, []);
  useEffect(() => { setLoading(false); }, [list]);

  useEffect(() => {
    if (!ledgerSupplier) { setLedger(null); return; }
    api.get(`/purchases/suppliers/${ledgerSupplier.id}/ledger`)
      .then(setLedger)
      .catch((e) => setErr(e.message));
  }, [ledgerSupplier]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', address: '', phone: '', vat_number: '', contact: '' });
    setModal('add');
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, address: s.address || '', phone: s.phone || '', vat_number: s.vat_number || '', contact: s.contact || '' });
    setModal('edit');
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/purchases/suppliers', form);
      else await api.patch(`/purchases/suppliers/${editing.id}`, form);
      setModal(null);
      setEditing(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (s) => {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    setErr('');
    try {
      await api.delete(`/purchases/suppliers/${s.id}`);
      if (ledgerSupplier?.id === s.id) {
        setLedgerSupplier(null);
        setLedger(null);
      }
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const normalize = (v) => String(v || '').toLowerCase();
  const supplierNeedle = supplierQuery.trim().toLowerCase();
  const ledgerNeedle = ledgerQuery.trim().toLowerCase();
  const filteredList = supplierNeedle
    ? list.filter((s) => {
        const hay = `${s.name} ${s.contact || ''} ${s.address || ''} ${s.phone || ''} ${s.vat_number || ''}`.toLowerCase();
        return hay.includes(supplierNeedle);
      })
    : list;
  const filteredPurchases = ledgerNeedle
    ? (ledger?.purchases || []).filter((p) => {
        const hay = [
          p.purchase_date,
          p.branch_name,
          p.invoice_no,
          p.total_amount,
          p.paid_amount,
          p.balance,
        ].map(normalize).join(' ');
        return hay.includes(ledgerNeedle);
      })
    : (ledger?.purchases || []);
  const filteredPayments = ledgerNeedle
    ? (ledger?.payments || []).filter((p) => {
        const hay = [
          p.payment_date,
          p.mode,
          p.amount,
          p.remarks,
        ].map(normalize).join(' ');
        return hay.includes(ledgerNeedle);
      })
    : (ledger?.payments || []);

  const downloadLedger = async (format) => {
    if (!ledgerSupplier) return;
    setErr('');
    try {
      if (format === 'pdf' && ledger) {
        const company = await getCompanyForPrint();
        const headerHtml = buildPrintHeaderHtml(company, 'Supplier Ledger', ledgerSupplier.name, { forPdf: true });
        const rowsPurch = filteredPurchases;
        const rowsPay = filteredPayments;
        const body = `
          <p class="summary-line">Total purchases: <strong>${fmt(ledger.totalPurchases)}</strong> &nbsp;|&nbsp; Total paid: <strong>${fmt(ledger.totalPaid)}</strong> &nbsp;|&nbsp; Balance: <strong>${fmt(ledger.balance)}</strong></p>
          <h2>Purchases</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th>Invoice</th>
                <th class="text-right">Total</th>
                <th class="text-right">Paid</th>
                <th class="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${rowsPurch.map(p => `
                <tr>
                  <td>${p.purchase_date}</td>
                  <td>${p.branch_name || '–'}</td>
                  <td>${p.invoice_no || '–'}</td>
                  <td class="text-right font-mono">${fmt(p.total_amount)}</td>
                  <td class="text-right font-mono">${fmt(p.paid_amount)}</td>
                  <td class="text-right font-mono">${fmt(p.balance)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <h2>Payments</h2>
          <table>
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Mode</th>
                <th class="text-right">Amount</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${rowsPay.map(p => `
                <tr>
                  <td>${p.payment_date}</td>
                  <td>${p.mode}</td>
                  <td class="text-right font-mono">${fmt(p.amount)}</td>
                  <td>${p.remarks || '–'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
        const fullHtml = buildPrintDocumentHtml(headerHtml, body, `Supplier Ledger - ${ledgerSupplier.name}`);
        await exportPrintAsPdf(fullHtml, `supplier-ledger-${ledgerSupplier.name || ledgerSupplier.id}.pdf`);
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/purchases/suppliers/${ledgerSupplier.id}/ledger/export?type=${format}`, {
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
      a.download = `supplier-ledger-${ledgerSupplier.name || ledgerSupplier.id}.${ext}`.replace(/\s+/g, '-');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const printLedger = async () => {
    if (!ledgerSupplier || !ledger) return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const headerHtml = buildPrintHeaderHtml(company, 'Supplier Ledger', ledgerSupplier.name);
      const rowsPurch = filteredPurchases;
      const rowsPay = filteredPayments;
      const body = `
          <p class="summary-line">Total purchases: <strong>${fmt(ledger.totalPurchases)}</strong> &nbsp;|&nbsp; Total paid: <strong>${fmt(ledger.totalPaid)}</strong> &nbsp;|&nbsp; Balance: <strong>${fmt(ledger.balance)}</strong></p>
          <h2>Purchases</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th>Invoice</th>
                <th class="text-right">Total</th>
                <th class="text-right">Paid</th>
                <th class="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${rowsPurch.map(p => `
                <tr>
                  <td>${p.purchase_date}</td>
                  <td>${p.branch_name || '–'}</td>
                  <td>${p.invoice_no || '–'}</td>
                  <td class="text-right font-mono">${fmt(p.total_amount)}</td>
                  <td class="text-right font-mono">${fmt(p.paid_amount)}</td>
                  <td class="text-right font-mono">${fmt(p.balance)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <h2>Payments</h2>
          <table>
            <thead>
              <tr>
                <th>Payment Date</th>
                <th>Mode</th>
                <th class="text-right">Amount</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${rowsPay.map(p => `
                <tr>
                  <td>${p.payment_date}</td>
                  <td>${p.mode}</td>
                  <td class="text-right font-mono">${fmt(p.amount)}</td>
                  <td>${p.remarks || '–'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      const html = buildPrintDocumentHtml(headerHtml, body, `Supplier Ledger - ${ledgerSupplier.name}`);
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      win.close();
    }
  };

  const openPay = (s) => {
    setPayModalSupplier(s);
    setPayForm({
      amount: '',
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'cash',
      remarks: '',
    });
  };

  const savePayment = async (e) => {
    e.preventDefault();
    if (!payModalSupplier) return;
    setErr('');
    const amt = parseFloat(payForm.amount);
    if (!amt || amt <= 0) {
      setErr('Enter a valid payment amount.');
      return;
    }
    try {
      await api.post('/payments', {
        category: 'supplier',
        reference_id: payModalSupplier.id,
        amount: amt,
        payment_date: payForm.payment_date,
        payment_method: payForm.payment_method === 'cash' ? 'cash' : payForm.payment_method,
        remarks: payForm.remarks || undefined,
      });
      setPayModalSupplier(null);
      setPayForm({ amount: '', payment_date: new Date().toISOString().slice(0, 10), payment_method: 'cash', remarks: '' });
      // Reload ledger and list
      load();
      loadSupplierBalances();
      if (ledgerSupplier?.id === payModalSupplier.id) {
        api.get(`/purchases/suppliers/${payModalSupplier.id}/ledger`)
          .then(setLedger)
          .catch(() => {});
      }
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier Management</h1>
          <p className="text-slate-500 mt-1">Suppliers list and ledger</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Supplier</button>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <Search className="w-4 h-4 text-slate-500" />
              <span>Search</span>
            </div>
            <input
              className="input w-full md:w-[420px]"
              placeholder="Search suppliers by name, contact, address"
              value={supplierQuery}
              onChange={(e) => setSupplierQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-600">Total pending balance (all suppliers)</p>
          <p className="mt-1 text-2xl font-bold text-rose-700 font-mono">{fmt(totalPendingSuppliers)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Address</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">VAT Number</th>
              <th className="text-right px-4 py-3 font-medium text-slate-700">Pending balance</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredList.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">{s.address || '–'}</td>
                  <td className="px-4 py-3">{s.phone || '–'}</td>
                  <td className="px-4 py-3">{s.vat_number || '–'}</td>
              <td className="px-4 py-3 text-right font-mono">
                {fmt(supplierBalances[s.id] ?? 0)}
              </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setLedgerSupplier(s)} className="btn-secondary text-xs mr-2"><BookOpen className="w-4 h-4" /> Ledger</button>
                    <button onClick={() => openPay(s)} className="btn-secondary text-xs mr-2 inline-flex items-center gap-1">
                      <DollarSign className="w-4 h-4" /> Pay
                    </button>
                    <button onClick={() => openEdit(s)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(s)} className="p-1.5 text-slate-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filteredList.length && !loading && <p className="p-8 text-center text-slate-500">No suppliers.</p>}
      </div>

      {ledgerSupplier && ledger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-5xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Ledger — {ledgerSupplier.name}</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Total purchases: {fmt(ledger.totalPurchases)} • Total paid: {fmt(ledger.totalPaid)} • Balance: {fmt(ledger.balance)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadLedger('pdf')}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadLedger('xlsx')}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3" /> Excel
                </button>
                <button
                  type="button"
                  onClick={printLedger}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  <Printer className="w-3 h-3" /> Print
                </button>
                <button
                  onClick={() => { setLedgerSupplier(null); setLedger(null); }}
                  className="btn-secondary text-xs"
                >
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
                placeholder="Search ledger by date, invoice, amount, remarks"
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
              />
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Branch</th>
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-right px-3 py-2">Paid</th>
                    <th className="text-right px-3 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPurchases.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">{p.purchase_date}</td>
                      <td className="px-3 py-2">{p.branch_name || '–'}</td>
                      <td className="px-3 py-2">{p.invoice_no || '–'}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(p.total_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(p.paid_amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(p.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredPurchases.length && <p className="p-3 text-sm text-slate-500">No purchases found.</p>}
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2">Payment Date</th>
                    <th className="text-left px-3 py-2">Mode</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">{p.payment_date}</td>
                      <td className="px-3 py-2">{p.mode}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(p.amount)}</td>
                      <td className="px-3 py-2">{p.remarks || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredPayments.length && <p className="p-3 text-sm text-slate-500">No payments found.</p>}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Supplier' : 'Edit Supplier'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label className="label">VAT Number</label><input className="input" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} /></div>
              <div><label className="label">Contact (other)</label><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Email or contact person" /></div>
              <div className="flex gap-3"><button type="submit" className="btn-primary">{modal === 'add' ? 'Add' : 'Update'}</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {payModalSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Pay Supplier — {payModalSupplier.name}</h2>
            <form onSubmit={savePayment} className="space-y-4">
              <div>
                <label className="label">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-full"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Payment date *</label>
                <input
                  type="date"
                  className="input w-full"
                  value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Payment method</label>
                <select
                  className="input w-full"
                  value={payForm.payment_method}
                  onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
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
                  value={payForm.remarks}
                  onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="btn-primary">Save Payment</button>
                <button type="button" onClick={() => setPayModalSupplier(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
