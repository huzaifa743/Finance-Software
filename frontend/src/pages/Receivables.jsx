import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, AlertTriangle, Users, FileText, Printer } from 'lucide-react';

export default function Receivables() {
  const [list, setList] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [recoverModal, setRecoverModal] = useState(null);
  const [customersModal, setCustomersModal] = useState(false);
  const [form, setForm] = useState({ customer_id: '', branch_id: '', amount: '', due_date: '' });
  const [recoverForm, setRecoverForm] = useState({ receivable_id: '', amount: '', remarks: '' });
  const [customerForm, setCustomerForm] = useState({ name: '', contact: '', address: '' });
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [ledgerPrintCustomer, setLedgerPrintCustomer] = useState(null);

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

  const saveCustomer = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (editingCustomer) await api.patch(`/receivables/customers/${editingCustomer.id}`, customerForm);
      else await api.post('/receivables/customers', customerForm);
      setEditingCustomer(null);
      setCustomerForm({ name: '', contact: '', address: '' });
      loadCustomers();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openEditCustomer = (c) => {
    setEditingCustomer(c);
    setCustomerForm({ name: c.name, contact: c.contact || '', address: c.address || '' });
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
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/receivables/ledger/${customerId}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load ledger');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receivables (Credit Sales)</h1>
          <p className="text-slate-500 mt-1">Customer ledger, recovery, overdue alerts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLedgerPrintCustomer(true)} className="btn-secondary"><FileText className="w-4 h-4" /> Print Ledger</button>
          <button onClick={() => { setCustomersModal(true); setEditingCustomer(null); setCustomerForm({ name: '', contact: '', address: '' }); }} className="btn-secondary"><Users className="w-4 h-4" /> Manage Customers</button>
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Receivable</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

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
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{r.customer_name || '–'}</td>
                  <td className="px-4 py-3">{r.branch_name || '–'}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt(r.amount)}</td>
                  <td className="px-4 py-3">{r.due_date || '–'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.status === 'pending' ? 'bg-amber-100 text-amber-800' : r.status === 'partial' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openLedgerPdf(r.customer_id, r.customer_name)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-primary-600 mr-2" title="Print ledger"><Printer className="w-3.5 h-3.5" /> Ledger</button>
                    {r.status !== 'recovered' && <button onClick={() => openRecover(r)} className="btn-primary text-xs">Recover</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && !loading && <p className="p-8 text-center text-slate-500">No receivables.</p>}
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

      {customersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Manage Customers</h2>
            <form onSubmit={saveCustomer} className="space-y-4 mb-6">
              <div><label className="label">Name *</label><input className="input" value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} required /></div>
              <div><label className="label">Contact</label><input className="input" value={customerForm.contact} onChange={(e) => setCustomerForm({ ...customerForm, contact: e.target.value })} /></div>
              <div><label className="label">Address</label><input className="input" value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })} /></div>
              <div className="flex gap-3"><button type="submit" className="btn-primary">{editingCustomer ? 'Update' : 'Add'}</button>{editingCustomer && <button type="button" onClick={() => { setEditingCustomer(null); setCustomerForm({ name: '', contact: '', address: '' }); }} className="btn-secondary">Cancel</button>}</div>
            </form>
            <div className="border-t border-slate-200 pt-4">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {customers.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-slate-100">
                    <span className="font-medium">{c.name}</span>
                    <button type="button" onClick={() => openEditCustomer(c)} className="text-sm text-primary-600 hover:underline">Edit</button>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setCustomersModal(false)} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}

      {ledgerPrintCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Print Receivables Ledger</h2>
            <p className="text-sm text-slate-600 mb-4">Select a customer to open their ledger (PDF). You can then print from the browser.</p>
            <select
              className="input w-full mb-4"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  const c = customers.find((x) => String(x.id) === id);
                  openLedgerPdf(id, c?.name);
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
    </div>
  );
}
