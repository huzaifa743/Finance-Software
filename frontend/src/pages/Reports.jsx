import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { FileDown, BarChart3, DollarSign, Wallet, Truck, TrendingUp, Printer } from 'lucide-react';
import { getCompanyForPrint, buildPrintHeaderHtml, PRINT_DOC_STYLES } from '../utils/printHeader';

export default function Reports() {
  const [module, setModule] = useState('sales');
  const [type, setType] = useState('daily');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [branchId, setBranchId] = useState('');
  const [data, setData] = useState(null);
  const [inventorySummary, setInventorySummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [branches, setBranches] = useState([]);

  useEffect(() => { api.get('/branches?active=1').then(setBranches).catch(() => {}); }, []);

  const fetchReport = () => {
    setLoading(true);
    setErr('');
    setData(null);
    setInventorySummary([]);
    const run = () => setLoading(false);
    const append = (base, extra) => (extra ? `${base}${base.includes('?') ? '&' : '?'}${extra}` : base);
    if (module === 'sales') {
      if (type === 'daily') api.get(append(`/sales/reports/daily?date=${date}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'monthly') api.get(append(`/sales/reports/monthly?month=${month}&year=${year}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else api.get(append(`/sales/reports/date-range?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'purchases') {
      if (type === 'daily') api.get(append(`/purchases/reports/daily?date=${date}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'monthly') api.get(append(`/purchases/reports/monthly?month=${month}&year=${year}`, branchId ? `branch_id=${branchId}` : '')).then(setData).catch((e) => setErr(e.message)).finally(run);
      else if (type === 'supplier') api.get(append(`/purchases/reports/supplier-wise`, from && to ? `from=${from}&to=${to}` : '')).then((d) => setData(Array.isArray(d) ? { rows: d, total: null } : d)).catch((e) => setErr(e.message)).finally(run);
      else api.get(append(`/purchases?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')).then((d) => setData({ rows: d, total: d.reduce((a, r) => a + (Number(r.total_amount) || 0), 0) })).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'inventory') {
      const summaryQs = new URLSearchParams();
      if (from) summaryQs.set('from', from);
      if (to) summaryQs.set('to', to);
      if (branchId) summaryQs.set('branch_id', branchId);
      Promise.all([
        api.get(append(`/inventory/sales?from=${from}&to=${to}`, branchId ? `branch_id=${branchId}` : '')),
        api.get(`/inventory/sales/summary?${summaryQs}`).catch(() => []),
      ]).then(([d, sum]) => {
        const rows = (d || []).map((r) => ({
          'Date when sold': r.sale_date,
          'Product': r.product_name,
          'Sold quantity': r.quantity,
          'Unit price': r.unit_price,
          'Total': r.total,
          'Branch': r.branch_name,
        }));
        setData({ rows, total: (d || []).reduce((a, r) => a + (Number(r.total) || 0), 0) });
        setInventorySummary(Array.isArray(sum) ? sum : []);
      }).catch((e) => setErr(e.message)).finally(run);
    } else if (module === 'branch_ledger') {
      const qs = from && to ? `from=${from}&to=${to}` : '';
      api.get(append('/receivables/branch-ledger', qs))
        .then((d) => (Array.isArray(d) ? { rows: d, total: d.reduce((a, r) => a + (Number(r.pending_balance) || 0), 0) } : d))
        .then(setData)
        .catch((e) => setErr(e.message))
        .finally(run);
    } else if (module === 'branch_summary') {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      api
        .get(`/dashboard/reports/branch-summary?${qs.toString()}`)
        .then(setData)
        .catch((e) => setErr(e.message))
        .finally(run);
    } else if (module === 'daily_combined') {
      api
        .get(append(`/dashboard/reports/daily-combined?date=${date}`, branchId ? `branch_id=${branchId}` : ''))
        .then(setData)
        .catch((e) => setErr(e.message))
        .finally(run);
    } else if (module === 'pl') {
      // For P&L, we keep the date range and branch filters but delegate to a dedicated page.
      // Here we simply navigate the user to the P&L screen via hash, or you can later refactor into an inline view.
      window.location.hash = '#/pl';
      run();
    } else run();
  };

  const exportData = async (fmt) => {
    try {
      let url = '';
      let fileModule = module;
      if (module === 'branch_ledger') {
        const q = new URLSearchParams({ type: fmt });
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        url = `/api/receivables/branch-ledger/export?${q.toString()}`;
      } else {
        const q = new URLSearchParams({ type: fmt, module });
        if (module === 'daily_combined') {
          q.set('date', date);
          if (branchId) q.set('branch_id', branchId);
        } else if (module === 'sales' || module === 'purchases') {
          if (type === 'daily' && date) {
            q.set('from', date);
            q.set('to', date);
          } else if (type === 'monthly' && month && year) {
            const m = String(month).padStart(2, '0');
            const y = parseInt(year, 10);
            const fromDate = `${y}-${m}-01`;
            const lastDay = new Date(y, parseInt(m, 10), 0).getDate();
            const toDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
            q.set('from', fromDate);
            q.set('to', toDate);
          } else {
            if (from) q.set('from', from);
            if (to) q.set('to', to);
          }
          if (branchId) q.set('branch_id', branchId);
        } else {
          if (from) q.set('from', from);
          if (to) q.set('to', to);
          if (branchId) q.set('branch_id', branchId);
        }
        url = `/api/dashboard/export?${q.toString()}`;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!res.ok) {
        const errText = await res.text();
        let msg = res.statusText;
        try {
          const d = JSON.parse(errText);
          if (d.error) msg = d.error;
        } catch (_) {}
        throw new Error(msg || 'Export failed');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${fileModule}-${Date.now()}.${fmt}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e.message);
    }
  };

  const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const rows = data?.rows || [];
  const total = data?.total ?? (Array.isArray(data) ? data.reduce((a, r) => a + (Number(r.total) || Number(r.total_amount) || Number(r.amount) || 0), 0) : 0);
  const branchLedgerTotals =
    module === 'branch_ledger' && rows.length
      ? {
          totalCreditSales: rows.reduce((a, r) => a + (Number(r.credit_sales) || 0), 0),
          totalReceivables: rows.reduce((a, r) => a + (Number(r.receivable_amount) || 0), 0),
          totalReceived: rows.reduce((a, r) => a + (Number(r.received_amount) || 0), 0),
          totalPending: rows.reduce((a, r) => a + (Number(r.pending_balance) || 0), 0),
        }
      : null;

  const printReport = async () => {
    if (!data || module === 'pl') return;
    const win = window.open('', '_blank');
    if (!win) return;
    try {
      const company = await getCompanyForPrint();
      const moduleTitles = {
        sales: 'Sales report',
        purchases: 'Purchases report',
        inventory: 'Inventory sales report',
        daily_combined: 'Daily combined report',
        branch_summary: 'Branch summary report',
        branch_ledger: 'Branch-wise receivables ledger',
      };
      const title = moduleTitles[module] || 'Report';

      const filters = [];
      if (type === 'daily' && date) filters.push(`Date: ${date}`);
      if (type === 'monthly' && month && year) filters.push(`Month: ${month}/${year}`);
      if ((type === 'range' || type === 'supplier' || type === 'category') && (from || to)) {
        filters.push(`From: ${from || '-'}  To: ${to || '-'}`);
      }
      if (branchId) {
        const branch = branches.find((b) => String(b.id) === String(branchId));
        filters.push(`Branch: ${branch?.name || branchId}`);
      }
      const subtitle = filters.join('  |  ');

      const headerHtml = buildPrintHeaderHtml(company, title, subtitle);
      let body = '';

      if (module === 'daily_combined') {
        const net = (Number(data.salesTotal) || 0) - (Number(data.purchaseTotal) || 0);
        body += `
          <p><strong>Date:</strong> ${data.date} ${data.branch_id ? `| Branch: ${data.branch_id}` : '| All branches'}</p>
          <p><strong>Total sales:</strong> ${fmt(data.salesTotal)} &nbsp; | &nbsp;
             <strong>Total purchases:</strong> ${fmt(data.purchaseTotal)} &nbsp; | &nbsp;
             <strong>Net:</strong> ${fmt(net)}</p>
          <h2>Sales</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th style="text-align:right;">Net sales</th>
              </tr>
            </thead>
            <tbody>
              ${(data.salesRows || [])
                .map(
                  (r) => `
                <tr>
                  <td>${r.sale_date}</td>
                  <td>${r.branch_name || '–'}</td>
                  <td style="text-align:right;">${fmt(r.net_sales)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
          <h2>Purchases</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Branch</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${(data.purchaseRows || [])
                .map(
                  (r) => `
                <tr>
                  <td>${r.purchase_date}</td>
                  <td>${r.branch_name || '–'}</td>
                  <td style="text-align:right;">${fmt(r.total_amount)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `;
      } else {
        const tableRows = rows;
        if (!tableRows.length) {
          body += '<p>No data for the selected filters.</p>';
        } else {
          if (typeof total === 'number') {
            body += `<p><strong>Total:</strong> ${fmt(total)}</p>`;
          }
          const keys = Object.keys(tableRows[0]).filter(
            (k) => !/^id$|^branch_id$|^category_id$|^supplier_id$/i.test(k)
          );
          body += `
            <table>
              <thead>
                <tr>
                  ${keys
                    .map(
                      (k) =>
                        `<th style="text-align:left;">${k
                          .replace(/_/g, ' ')
                          .replace(/\b\w/g, (c) => c.toUpperCase())}</th>`
                    )
                    .join('')}
                </tr>
              </thead>
              <tbody>
                ${tableRows
                  .map(
                    (r) => `
                  <tr>
                    ${keys
                      .map((k) => {
                        const v = r[k];
                        const display =
                          typeof v === 'number'
                            ? fmt(v)
                            : v === null || v === undefined || v === ''
                            ? '–'
                            : String(v);
                        const align = typeof v === 'number' ? 'right' : 'left';
                        return `<td style="text-align:${align};">${display}</td>`;
                      })
                      .join('')}
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          `;
        }

        if (module === 'inventory' && inventorySummary.length > 0) {
          body += `
            <h2>Summary by product (selected period)</h2>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th style="text-align:right;">Total quantity sold</th>
                  <th style="text-align:right;">Total amount</th>
                </tr>
              </thead>
              <tbody>
                ${[...inventorySummary]
                  .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
                  .map(
                    (row) => `
                  <tr>
                    <td>${row.product_name || '–'}</td>
                    <td style="text-align:right;">${fmt(row.total_quantity_sold)}</td>
                    <td style="text-align:right;">${fmt(row.total_amount)}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          `;
        }
      }

      const html = `
        <html>
          <head>
            <title>${title}</title>
            <style>
              ${PRINT_DOC_STYLES}
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
      // eslint-disable-next-line no-console
      console.error(e);
      win.close();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports & Analytics</h1>
          <p className="text-slate-500 mt-1">Profit & Loss, sales, purchases, inventory, combined reports</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportData('xlsx')} className="btn-secondary">
            <FileDown className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => exportData('pdf')} className="btn-secondary">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={printReport}
            className="btn-secondary"
            disabled={!data || module === 'pl'}
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{err}</div>}

      <div className="card p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Module</label>
            <select className="input w-56" value={module} onChange={(e) => {
              const next = e.target.value;
              setModule(next);
              setData(null);
              if (next === 'inventory') setType('range');
              if (next === 'daily_combined') setType('daily');
              if (next === 'branch_ledger') setType('range');
              if (next === 'branch_summary') setType('range');
              if (next === 'pl') setType('range');
              setInventorySummary([]);
            }}>
              <option value="sales">Sales</option>
              <option value="purchases">Purchases</option>
              <option value="inventory">Inventory</option>
              <option value="daily_combined">Daily combined (Sales + Purchases)</option>
              <option value="branch_summary">Branch-wise sales / bank / purchases</option>
              <option value="branch_ledger">Branch-wise receivables ledger</option>
              <option value="pl">Profit &amp; Loss</option>
            </select>
          </div>
          <div>
            <label className="label">Report type</label>
            <select className="input w-40" value={type} onChange={(e) => { setType(e.target.value); setData(null); }}>
              {module !== 'inventory' && module !== 'daily_combined' && module !== 'branch_ledger' && module !== 'branch_summary' && <option value="daily">Daily</option>}
              {module !== 'inventory' && module !== 'daily_combined' && module !== 'branch_ledger' && module !== 'branch_summary' && <option value="monthly">Monthly</option>}
              {module !== 'daily_combined' && <option value="range">Date range</option>}
              {module === 'purchases' && <option value="supplier">Supplier-wise</option>}
              {module === 'daily_combined' && <option value="daily">Daily</option>}
            </select>
          </div>
          {type === 'daily' && <div><label className="label">Date</label><input type="date" className="input w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>}
          {type === 'monthly' && (
            <>
              <div><label className="label">Month</label><select className="input w-32" value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={String(m).padStart(2, '0')}>{m}</option>)}</select></div>
              <div><label className="label">Year</label><input className="input w-24" value={year} onChange={(e) => setYear(e.target.value)} /></div>
            </>
          )}
          {(type === 'range' || type === 'supplier' || type === 'category') && (
            <>
              <div><label className="label">From</label><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="label">To</label><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <div>
            <label className="label">Branch</label>
            <select
              className="input w-40"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={module === 'branch_ledger'}
            >
              <option value="">All</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button onClick={fetchReport} className="btn-primary" disabled={loading}>{loading ? 'Loading…' : 'Run'}</button>
        </div>
      </div>

      {data && module === 'daily_combined' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">
              Daily combined — {data.date} {data.branch_id ? `(Branch ${data.branch_id})` : '(All branches)'}
            </h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Total sales</p>
                <p className="mt-1 text-xl font-bold text-emerald-900">{fmt(data.salesTotal)}</p>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Total purchases</p>
                <p className="mt-1 text-xl font-bold text-amber-900">{fmt(data.purchaseTotal)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">Net (sales - purchases)</p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {fmt((Number(data.salesTotal) || 0) - (Number(data.purchaseTotal) || 0))}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">Sales</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  {data.salesRows && data.salesRows.length ? (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-700">Date</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-700">Branch</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-700">Net sales</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {data.salesRows.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5">{r.sale_date}</td>
                            <td className="px-3 py-1.5">{r.branch_name || '–'}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(r.net_sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="p-3 text-xs text-slate-500 text-center">No sales for this day.</p>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">Purchases</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  {data.purchaseRows && data.purchaseRows.length ? (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-700">Date</th>
                          <th className="px-3 py-2 text-left font-medium text-slate-700">Branch</th>
                          <th className="px-3 py-2 text-right font-medium text-slate-700">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {data.purchaseRows.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5">{r.purchase_date}</td>
                            <td className="px-3 py-1.5">{r.branch_name || '–'}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(r.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="p-3 text-xs text-slate-500 text-center">No purchases for this day.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {data && module !== 'daily_combined' && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            {module === 'branch_ledger' ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900">Branch-wise receivables summary</h3>
                  <p className="text-xs text-slate-500">Total credit sales, received and pending across all branches.</p>
                </div>
                {branchLedgerTotals && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                      <p className="font-medium text-emerald-700 uppercase tracking-wide">Total credit sales</p>
                      <p className="mt-1 text-base font-bold text-emerald-900">{fmt(branchLedgerTotals.totalCreditSales)}</p>
                    </div>
                    <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
                      <p className="font-medium text-sky-700 uppercase tracking-wide">Total receivables</p>
                      <p className="mt-1 text-base font-bold text-sky-900">{fmt(branchLedgerTotals.totalReceivables)}</p>
                    </div>
                    <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2">
                      <p className="font-medium text-indigo-700 uppercase tracking-wide">Total received</p>
                      <p className="mt-1 text-base font-bold text-indigo-900">{fmt(branchLedgerTotals.totalReceived)}</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                      <p className="font-medium text-amber-700 uppercase tracking-wide">Pending received</p>
                      <p className="mt-1 text-base font-bold text-amber-900">{fmt(branchLedgerTotals.totalPending)}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-slate-900">
                  {module === 'inventory' ? 'Inventory Sales — Date when sold · Sold quantity' : 'Report result'}
                </h3>
                {typeof total === 'number' && <p className="text-lg font-bold text-primary-600">Total: {fmt(total)}</p>}
              </>
            )}
          </div>
          {module === 'inventory' && inventorySummary.length > 0 && (
            <div className="p-4 border-b border-slate-200">
              <h4 className="text-sm font-semibold text-slate-800 mb-2">Summary by product (selected period)</h4>
              <p className="text-xs text-slate-500 mb-2">Total quantity sold and total amount per product for the selected date range.</p>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">Product</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-700">Total quantity sold</th>
                      <th className="text-right px-4 py-2 font-medium text-slate-700">Total amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {[...inventorySummary]
                      .sort((a, b) => (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0))
                      .map((row) => (
                        <tr key={row.product_id || row.product_name} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium">{row.product_name || '–'}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(row.total_quantity_sold)}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(row.total_amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-700">
                Grand total quantity: {fmt(inventorySummary.reduce((a, r) => a + (Number(r.total_quantity_sold) || 0), 0))} · Grand total amount: {fmt(inventorySummary.reduce((a, r) => a + (Number(r.total_amount) || 0), 0))}
              </p>
            </div>
          )}
          <div className="overflow-x-auto">
            {rows.length ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {Object.keys(rows[0]).filter((k) => !/^id$|^branch_id$|^category_id$|^supplier_id$/i.test(k)).map((k) => (
                      <th key={k} className="text-left px-4 py-3 font-medium text-slate-700 capitalize">{k.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      {Object.entries(r).filter(([k]) => !/^id$|^branch_id$|^category_id$|^supplier_id$/i.test(k)).map(([k, v]) => (
                        <td key={k} className="px-4 py-3">{typeof v === 'number' ? fmt(v) : String(v ?? '–')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-8 text-center text-slate-500">No data.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
