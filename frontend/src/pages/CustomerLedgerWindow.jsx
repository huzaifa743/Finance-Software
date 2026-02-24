import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { FileDown, Printer, X } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, exportPrintAsPdf } from '../utils/printHeader';

export default function CustomerLedgerWindow() {
  const { customerId } = useParams();
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    setErr('');
    api
      .get(`/receivables/ledger/${customerId}`)
      .then(setLedgerData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  const exportLedger = async (type) => {
    if (!customerId) return;
    setErr('');
    try {
      if (type === 'pdf' && ledgerData) {
        const company = await getCompanyForPrint();
        const headerHtml = buildPrintHeaderHtml(company, 'Receivables Ledger', `Customer: ${ledgerData.customer?.name || 'Customer'}`, { forPdf: true });
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
            <title>Receivables Ledger - ${ledgerData.customer?.name || customerId}</title>
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
        await exportPrintAsPdf(fullHtml, `receivable-ledger-${ledgerData.customer?.name || customerId}.pdf`);
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

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Receivables Ledger — {ledgerData?.customer?.name || 'Customer'}
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => exportLedger('xlsx')} className="btn-secondary">
            <FileDown className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => exportLedger('pdf')} className="btn-secondary">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button onClick={() => window.print()} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button
            onClick={() => window.close()}
            className="btn-secondary"
            title="Close window"
          >
            <X className="w-4 h-4" /> Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6 print:block">
        {err && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 mb-4">{err}</div>
        )}
        {loading && <p className="text-slate-500">Loading ledger…</p>}
        {ledgerData && !loading && (
          <>
            {ledgerData.customer && (
              <div className="mb-4 p-4 bg-white rounded-lg border border-slate-200">
                <p className="font-semibold text-slate-900">{ledgerData.customer.name}</p>
                <p className="text-sm text-slate-600">
                  Contact: {ledgerData.customer.contact || 'N/A'}
                </p>
                <p className="text-sm text-slate-600">
                  Address: {ledgerData.customer.address || 'N/A'}
                </p>
                <p className="mt-2 text-sm font-medium text-primary-700">
                  Total due: {fmt(ledgerData.totalDue)}
                </p>
                <p className="text-sm text-slate-600">
                  Total recovered: {fmt(ledgerData.recoveredTotal)}
                </p>
              </div>
            )}
            <h3 className="font-semibold text-slate-800 mt-4 mb-2">Ledger (Credit / Debit / Balance)</h3>
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
                {(ledgerData.entries || []).map((e) => (
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
            {(!ledgerData.entries || !ledgerData.entries.length) && (
              <p className="text-slate-500 mb-6">No ledger entries yet.</p>
            )}
            <h3 className="font-semibold text-slate-800 mt-4 mb-2">Credit entries (Receivables)</h3>
            <table className="w-full text-sm border border-slate-200 mb-6 bg-white">
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
            {(!ledgerData.receivables || !ledgerData.receivables.length) && (
              <p className="text-slate-500 mb-6">No receivables entries.</p>
            )}
            <h3 className="font-semibold text-slate-800 mt-4 mb-2">Recoveries</h3>
            <table className="w-full text-sm border border-slate-200 bg-white">
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
            {(!ledgerData.recoveries || !ledgerData.recoveries.length) && (
              <p className="text-slate-500">No recoveries yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
