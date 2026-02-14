import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, BookOpen } from 'lucide-react';

export default function Suppliers() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', address: '' });
  const [ledgerSupplier, setLedgerSupplier] = useState(null);
  const [ledger, setLedger] = useState(null);

  const load = () => api.get('/purchases/suppliers').then(setList).catch((e) => setErr(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  useEffect(() => {
    if (!ledgerSupplier) { setLedger(null); return; }
    api.get(`/purchases/suppliers/${ledgerSupplier.id}/ledger`)
      .then(setLedger)
      .catch((e) => setErr(e.message));
  }, [ledgerSupplier]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', contact: '', address: '' });
    setModal('add');
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({ name: s.name, contact: s.contact || '', address: s.address || '' });
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

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Contact</th>
                <th className="text-left px-4 py-3 font-medium text-slate-700">Address</th>
                <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {list.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">{s.contact || '–'}</td>
                  <td className="px-4 py-3">{s.address || '–'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setLedgerSupplier(s)} className="btn-secondary text-xs mr-2"><BookOpen className="w-4 h-4" /> Ledger</button>
                    <button onClick={() => openEdit(s)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No suppliers.</p>}
      </div>

      {ledgerSupplier && ledger && (
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Ledger — {ledgerSupplier.name}</h3>
            <button onClick={() => { setLedgerSupplier(null); setLedger(null); }} className="btn-secondary text-xs">Close</button>
          </div>
          <p className="text-sm text-slate-600 mt-2">Total purchases: {fmt(ledger.totalPurchases)} • Total paid: {fmt(ledger.totalPaid)} • Balance: {fmt(ledger.balance)}</p>
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
                {(ledger.purchases || []).map((p) => (
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
                {(ledger.payments || []).map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{p.payment_date}</td>
                    <td className="px-3 py-2">{p.mode}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(p.amount)}</td>
                    <td className="px-3 py-2">{p.remarks || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Supplier' : 'Edit Supplier'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Contact</label><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="flex gap-3"><button type="submit" className="btn-primary">{modal === 'add' ? 'Add' : 'Update'}</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
