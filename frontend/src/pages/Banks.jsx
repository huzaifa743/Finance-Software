import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, ArrowRightLeft, TrendingUp } from 'lucide-react';

export default function Banks() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [transferModal, setTransferModal] = useState(false);
  const [ledgerBank, setLedgerBank] = useState(null);
  const [form, setForm] = useState({ name: '', account_number: '', opening_balance: 0 });
  const [transferForm, setTransferForm] = useState({ from_bank_id: '', to_bank_id: '', amount: '', transaction_date: '', description: '' });
  const [txForm, setTxForm] = useState({ bank_id: '', type: 'deposit', amount: '', transaction_date: '', reference: '', description: '' });
  const [txModal, setTxModal] = useState(null);
  const [ledger, setLedger] = useState(null);

  const load = () => api.get('/banks').then(setList).catch((e) => setErr(e.message));

  useEffect(() => { load(); }, []);
  useEffect(() => { setLoading(false); }, [list]);

  useEffect(() => {
    if (!ledgerBank) { setLedger(null); return; }
    api.get(`/banks/${ledgerBank.id}/ledger`).then(setLedger).catch(() => setLedger(null));
  }, [ledgerBank]);

  const openAdd = () => {
    setForm({ name: '', account_number: '', opening_balance: 0 });
    setModal('add');
  };

  const openEdit = (b) => {
    setForm({ id: b.id, name: b.name, account_number: b.account_number || '', opening_balance: b.opening_balance ?? 0 });
    setModal('edit');
  };

  const openTransfer = () => {
    setTransferForm({ from_bank_id: list[0]?.id || '', to_bank_id: list[1]?.id || list[0]?.id || '', amount: '', transaction_date: new Date().toISOString().slice(0, 10), description: '' });
    setTransferModal(true);
  };

  const openTx = (b) => {
    setTxForm({ bank_id: b.id, type: 'deposit', amount: '', transaction_date: new Date().toISOString().slice(0, 10), reference: '', description: '' });
    setTxModal(b);
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (modal === 'add') await api.post('/banks', form);
      else await api.patch(`/banks/${form.id}`, form);
      setModal(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const transfer = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/banks/transfer', transferForm);
      setTransferModal(false);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const addTx = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post(`/banks/${txForm.bank_id}/transactions`, txForm);
      setTxModal(null);
      load();
      if (ledgerBank && Number(ledgerBank.id) === Number(txForm.bank_id)) api.get(`/banks/${ledgerBank.id}/ledger`).then(setLedger).catch(() => {});
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bank Management</h1>
          <p className="text-slate-500 mt-1">Accounts, deposits, payments, transfers, reconciliation</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openTransfer} className="btn-secondary"><ArrowRightLeft className="w-4 h-4" /> Transfer</button>
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add Bank</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((b) => (
          <div key={b.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">{b.name}</h3>
                <p className="text-sm text-slate-500 font-mono">{b.account_number || '–'}</p>
                <p className="mt-2 text-lg font-bold text-primary-600">{fmt(b.current_balance)}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => openTx(b)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Add transaction">+</button>
                <button onClick={() => openEdit(b)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => setLedgerBank(ledgerBank?.id === b.id ? null : b)} className="p-1.5 text-slate-500 hover:text-primary-600" title="Ledger"><TrendingUp className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!list.length && !loading && <p className="card p-8 text-center text-slate-500">No banks. Add one to get started.</p>}

      {ledgerBank && ledger && (
        <div className="card p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Ledger — {ledgerBank.name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Type</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-700">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Ref</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(ledger.transactions || []).map((t) => (
                  <tr key={t.id}><td className="px-4 py-3">{t.transaction_date}</td><td className="px-4 py-3">{t.type}</td><td className="px-4 py-3 text-right font-mono">{fmt(t.amount)}</td><td className="px-4 py-3">{t.reference || '–'}</td><td className="px-4 py-3">{t.description || '–'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm font-medium text-slate-700">Balance: {fmt(ledger.bank?.current_balance)}</p>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{modal === 'add' ? 'Add Bank' : 'Edit Bank'}</h2>
            <form onSubmit={save} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="label">Account #</label><input className="input" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
              {modal === 'add' && <div><label className="label">Opening Balance</label><input type="number" step="0.01" className="input" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>}
              {modal === 'edit' && <div><label className="label">Opening Balance</label><input type="number" step="0.01" className="input" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>}
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Transfer between banks</h2>
            <form onSubmit={transfer} className="space-y-4">
              <div><label className="label">From *</label><select className="input" value={transferForm.from_bank_id} onChange={(e) => setTransferForm({ ...transferForm, from_bank_id: e.target.value })} required>{list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="label">To *</label><select className="input" value={transferForm.to_bank_id} onChange={(e) => setTransferForm({ ...transferForm, to_bank_id: e.target.value })} required>{list.filter((b) => String(b.id) !== String(transferForm.from_bank_id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} required /></div>
              <div><label className="label">Date *</label><input type="date" className="input" value={transferForm.transaction_date} onChange={(e) => setTransferForm({ ...transferForm, transaction_date: e.target.value })} required /></div>
              <div><label className="label">Description</label><input className="input" value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Transfer</button><button type="button" onClick={() => setTransferModal(false)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {txModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add transaction — {txModal.name}</h2>
            <form onSubmit={addTx} className="space-y-4">
              <div><label className="label">Type</label><select className="input" value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option><option value="payment">Payment</option><option value="transfer_in">Transfer In</option><option value="transfer_out">Transfer Out</option></select></div>
              <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required /></div>
              <div><label className="label">Date *</label><input type="date" className="input" value={txForm.transaction_date} onChange={(e) => setTxForm({ ...txForm, transaction_date: e.target.value })} required /></div>
              <div><label className="label">Reference</label><input className="input" value={txForm.reference} onChange={(e) => setTxForm({ ...txForm, reference: e.target.value })} /></div>
              <div><label className="label">Description</label><input className="input" value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Add</button><button type="button" onClick={() => setTxModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
