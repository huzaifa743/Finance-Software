import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Plus, Pencil, Package, CreditCard, DollarSign } from 'lucide-react';

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [assetModal, setAssetModal] = useState(null);
  const [loanModal, setLoanModal] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [loanDetail, setLoanDetail] = useState(null);
  const [assetForm, setAssetForm] = useState({ name: '', purchase_date: '', cost: 0, depreciation_rate: 0, current_value: '' });
  const [loanForm, setLoanForm] = useState({ name: '', principal: '', interest_rate: 0, tenure_months: '', emi_amount: '', start_date: '' });
  const [tab, setTab] = useState('assets');

  const loadAssets = () => api.get('/assets/assets').then(setAssets).catch((e) => setErr(e.message));
  const loadLoans = () => api.get('/assets/loans').then(setLoans).catch((e) => setErr(e.message));

  useEffect(() => { loadAssets(); loadLoans(); }, []);
  useEffect(() => { setLoading(false); }, [assets, loans]);

  const openAssetAdd = () => {
    setAssetForm({ name: '', purchase_date: '', cost: 0, depreciation_rate: 0, current_value: '' });
    setAssetModal('add');
  };

  const openAssetEdit = (a) => {
    setAssetForm({ id: a.id, name: a.name, purchase_date: a.purchase_date || '', cost: a.cost ?? 0, depreciation_rate: a.depreciation_rate ?? 0, current_value: a.current_value ?? a.cost });
    setAssetModal('edit');
  };

  const openLoanAdd = () => {
    setLoanForm({ name: '', principal: '', interest_rate: 0, tenure_months: '', emi_amount: '', start_date: '' });
    setLoanModal('add');
  };

  const saveAsset = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (assetModal === 'add') await api.post('/assets/assets', { ...assetForm, current_value: assetForm.current_value || assetForm.cost });
      else await api.patch(`/assets/assets/${assetForm.id}`, assetForm);
      setAssetModal(null);
      loadAssets();
    } catch (e) {
      setErr(e.message);
    }
  };

  const saveLoan = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/assets/loans', loanForm);
      setLoanModal(null);
      loadLoans();
    } catch (e) {
      setErr(e.message);
    }
  };

  const openPayModal = (loan) => {
    setPayModal(loan);
    setLoanDetail(null);
    api.get(`/assets/loans/${loan.id}`).then(setLoanDetail).catch((e) => setErr(e.message));
  };

  const payInstallment = async (loanId, instId) => {
    try {
      await api.post(`/assets/loans/${loanId}/installments/${instId}/pay`, {});
      api.get(`/assets/loans/${loanId}`).then(setLoanDetail);
      loadLoans();
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assets, Loans & Installments</h1>
          <p className="text-slate-500 mt-1">Asset registry, depreciation, loans, EMI tracking</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAssetAdd} className="btn-secondary"><Package className="w-4 h-4" /> Add Asset</button>
          <button onClick={openLoanAdd} className="btn-primary"><CreditCard className="w-4 h-4" /> Add Loan</button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setTab('assets')} className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === 'assets' ? 'bg-white border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Assets</button>
        <button onClick={() => setTab('loans')} className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === 'loans' ? 'bg-white border border-b-0 border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Loans</button>
      </div>

      {tab === 'assets' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">Purchase Date</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-700">Cost</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-700">Depreciation %</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-700">Current Value</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {assets.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{a.name}</td>
                    <td className="px-4 py-3">{a.purchase_date || '–'}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(a.cost)}</td>
                    <td className="px-4 py-3 text-right font-mono">{a.depreciation_rate}%</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(a.current_value)}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => openAssetEdit(a)} className="p-1.5 text-slate-500 hover:text-primary-600"><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!assets.length && !loading && <p className="p-8 text-center text-slate-500">No assets.</p>}
        </div>
      )}

      {tab === 'loans' && (
        <div className="space-y-4">
          {loans.map((l) => (
            <div key={l.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{l.name}</h3>
                  <p className="text-sm text-slate-500">Principal {fmt(l.principal)} • EMI {fmt(l.emi_amount)} • {l.status}</p>
                </div>
                <button onClick={() => openPayModal(l)} className="btn-secondary text-xs">View / Pay EMI</button>
              </div>
            </div>
          ))}
          {!loans.length && !loading && <p className="card p-8 text-center text-slate-500">No loans.</p>}
        </div>
      )}

      {assetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{assetModal === 'add' ? 'Add Asset' : 'Edit Asset'}</h2>
            <form onSubmit={saveAsset} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} required /></div>
              <div><label className="label">Purchase Date</label><input type="date" className="input" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} /></div>
              <div><label className="label">Cost</label><input type="number" step="0.01" className="input" value={assetForm.cost} onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })} /></div>
              <div><label className="label">Depreciation %</label><input type="number" step="0.01" className="input" value={assetForm.depreciation_rate} onChange={(e) => setAssetForm({ ...assetForm, depreciation_rate: e.target.value })} /></div>
              <div><label className="label">Current Value</label><input type="number" step="0.01" className="input" value={assetForm.current_value} onChange={(e) => setAssetForm({ ...assetForm, current_value: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setAssetModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {loanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Add Loan</h2>
            <form onSubmit={saveLoan} className="space-y-4">
              <div><label className="label">Name *</label><input className="input" value={loanForm.name} onChange={(e) => setLoanForm({ ...loanForm, name: e.target.value })} required /></div>
              <div><label className="label">Principal *</label><input type="number" step="0.01" className="input" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} required /></div>
              <div><label className="label">Interest %</label><input type="number" step="0.01" className="input" value={loanForm.interest_rate} onChange={(e) => setLoanForm({ ...loanForm, interest_rate: e.target.value })} /></div>
              <div><label className="label">Tenure (months)</label><input type="number" className="input" value={loanForm.tenure_months} onChange={(e) => setLoanForm({ ...loanForm, tenure_months: e.target.value })} /></div>
              <div><label className="label">EMI Amount</label><input type="number" step="0.01" className="input" value={loanForm.emi_amount} onChange={(e) => setLoanForm({ ...loanForm, emi_amount: e.target.value })} /></div>
              <div><label className="label">Start Date</label><input type="date" className="input" value={loanForm.start_date} onChange={(e) => setLoanForm({ ...loanForm, start_date: e.target.value })} /></div>
              <div className="flex gap-3 pt-4"><button type="submit" className="btn-primary">Save</button><button type="button" onClick={() => setLoanModal(null)} className="btn-secondary">Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Installments — {payModal.name}</h2>
            {!loanDetail ? <p className="text-sm text-slate-500 mb-4">Loading…</p> : (
              <>
                <p className="text-sm text-slate-600 mb-4">Balance: {fmt(loanDetail.balance)} | Paid: {fmt(loanDetail.paidTotal)}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-slate-700">Due Date</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-700">Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-slate-700">Status</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-700">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(loanDetail.installments || []).map((i) => (
                        <tr key={i.id}>
                          <td className="px-3 py-2">{i.due_date}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(i.amount)}</td>
                          <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${i.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{i.status}</span></td>
                          <td className="px-3 py-2 text-right">{i.status !== 'paid' && <button onClick={() => payInstallment(payModal.id, i.id)} className="btn-primary text-xs">Pay</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <button onClick={() => { setPayModal(null); setLoanDetail(null); }} className="btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
