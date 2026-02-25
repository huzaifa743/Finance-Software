import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import db from '../db/database.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function bankBalance() {
  const banks = db.prepare('SELECT id, opening_balance FROM banks').all();
  let total = 0;
  for (const b of banks) {
    const dep = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('deposit', 'transfer_in')").get(b.id);
    const wit = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('withdrawal', 'payment', 'transfer_out')").get(b.id);
    total += (parseFloat(b.opening_balance) || 0) + (parseFloat(dep?.t) || 0) - (parseFloat(wit?.t) || 0);
  }
  return total;
}

function bankListWithBalance() {
  const banks = db.prepare('SELECT id, name, account_number, opening_balance FROM banks ORDER BY name').all();
  return banks.map((b) => {
    const dep = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('deposit', 'transfer_in')").get(b.id);
    const wit = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('withdrawal', 'payment', 'transfer_out')").get(b.id);
    const balance = (parseFloat(b.opening_balance) || 0) + (parseFloat(dep?.t) || 0) - (parseFloat(wit?.t) || 0);
    return { id: b.id, name: b.name, account_number: b.account_number, balance };
  });
}

router.get('/', authenticate, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthEnd = today.slice(0, 8) + String(lastDay).padStart(2, '0');

  const salesTodayCash = db.prepare(
    'SELECT COALESCE(SUM(cash_amount), 0) as t FROM sales WHERE sale_date = ?'
  ).get(today);
  const salesTodayBank = db.prepare(
    'SELECT COALESCE(SUM(bank_amount), 0) as t FROM sales WHERE sale_date = ?'
  ).get(today);
  const salesTodayRealized = {
    t: (parseFloat(salesTodayCash?.t) || 0) + (parseFloat(salesTodayBank?.t) || 0),
  };
  const salesTodayCredit = db.prepare(
    'SELECT COALESCE(SUM(credit_amount), 0) as t FROM sales WHERE sale_date = ?'
  ).get(today);
  const receivableRecoveryToday = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t
    FROM payments
    WHERE type = 'receivable_recovery' AND payment_date = ?
  `).get(today);
  const salesMonth = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?').get(monthStart, monthEnd);
  const salesMonthCash = db.prepare(
    'SELECT COALESCE(SUM(cash_amount), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?'
  ).get(monthStart, monthEnd);
  const salesMonthBank = db.prepare(
    'SELECT COALESCE(SUM(bank_amount), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?'
  ).get(monthStart, monthEnd);
  const purchasesMonth = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?').get(monthStart, monthEnd);

  const gross = parseFloat(salesMonth?.t) || 0;
  const cost = parseFloat(purchasesMonth?.t) || 0;
  const netProfit = gross - cost;

  const receivables = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t FROM receivables WHERE status IN ('pending', 'partial')
  `).get();
  const payables = db.prepare(`
    SELECT COALESCE(SUM(balance), 0) as t FROM purchases WHERE balance > 0
  `).get();
  const totalPaidAll = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t
    FROM payments
  `).get();
  const receivableRecoveredTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t
    FROM payments
    WHERE type = 'receivable_recovery'
  `).get();

  const branchSales = db.prepare(`
    SELECT b.id, b.name, COALESCE(SUM(s.net_sales), 0) as total
    FROM branches b
    LEFT JOIN sales s ON s.branch_id = b.id AND s.sale_date >= ? AND s.sale_date <= ?
    WHERE b.is_active = 1
    GROUP BY b.id, b.name
    ORDER BY total DESC
  `).all(monthStart, monthEnd);

  const totalCashOpening = db.prepare('SELECT COALESCE(SUM(opening_cash), 0) as t FROM branches WHERE is_active = 1').get();
  const cashSalesTotal = db.prepare('SELECT COALESCE(SUM(cash_amount), 0) as t FROM sales').get();
  // Treat deposits created from sale records as direct-to-bank receipts (do not reduce cash-in-hand)
  const bankDeposits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t
    FROM bank_transactions
    WHERE type IN ('deposit', 'transfer_in')
      AND (reference IS NULL OR reference NOT LIKE 'sale-%')
  `).get();
  const bankWithdrawals = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE type IN ('withdrawal', 'transfer_out')").get();
  const cashPaymentsOut = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM payments WHERE mode = 'cash' AND type IN ('supplier', 'rent_bill', 'salary')").get();
  const cashReceivedRecovery = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM payments WHERE mode = 'cash' AND type = 'receivable_recovery'").get();
  const cashInHand =
    (parseFloat(totalCashOpening?.t) || 0) +
    (parseFloat(cashSalesTotal?.t) || 0) +
    (parseFloat(cashReceivedRecovery?.t) || 0) -
    ((parseFloat(bankDeposits?.t) || 0) - (parseFloat(bankWithdrawals?.t) || 0)) -
    (parseFloat(cashPaymentsOut?.t) || 0);

  res.json({
    widgets: {
      salesToday: (parseFloat(salesTodayRealized?.t) || 0) + (parseFloat(receivableRecoveryToday?.t) || 0),
      salesTodayCash: parseFloat(salesTodayCash?.t) || 0,
      salesTodayBank: parseFloat(salesTodayBank?.t) || 0,
      salesTodayCredit: parseFloat(salesTodayCredit?.t) || 0,
      salesOnCredit: parseFloat(receivables?.t) || 0,
      salesMonth: parseFloat(salesMonth?.t) || 0,
      salesMonthCash: parseFloat(salesMonthCash?.t) || 0,
      salesMonthBank: parseFloat(salesMonthBank?.t) || 0,
      netProfit,
      bankBalance: bankBalance(),
      receivables: parseFloat(receivables?.t) || 0,
      payables: parseFloat(payables?.t) || 0,
      cashInHand,
      receivableRecovered: parseFloat(receivableRecoveredTotal?.t) || 0,
      totalPaid: parseFloat(totalPaidAll?.t) || 0,
    },
    bankAccounts: bankListWithBalance(),
    branchComparison: branchSales,
    date: today,
    monthStart,
    monthEnd,
  });
});

function buildExportData(module, { from, to, branch_id }) {
  let data = [];
  let filename = 'export';
  const params = [];
  if (module === 'sales') {
    let sql = 'SELECT * FROM sales WHERE 1=1';
    if (from) { sql += ' AND sale_date >= ?'; params.push(from); }
    if (to) { sql += ' AND sale_date <= ?'; params.push(to); }
    if (branch_id) { sql += ' AND branch_id = ?'; params.push(branch_id); }
    sql += ' ORDER BY sale_date DESC';
    data = db.prepare(sql).all(...params);
    filename = `sales_${from || 'all'}_${to || 'all'}`;
  } else if (module === 'purchases') {
    let sql = 'SELECT p.*, s.name as supplier_name FROM purchases p LEFT JOIN suppliers s ON p.supplier_id = s.id WHERE 1=1';
    if (from) { sql += ' AND p.purchase_date >= ?'; params.push(from); }
    if (to) { sql += ' AND p.purchase_date <= ?'; params.push(to); }
    if (branch_id) { sql += ' AND p.branch_id = ?'; params.push(branch_id); }
    sql += ' ORDER BY p.purchase_date DESC';
    data = db.prepare(sql).all(...params);
    filename = `purchases_${from || 'all'}_${to || 'all'}`;
  } else if (module === 'inventory') {
    let sql = `
      SELECT i.*, p.name as product_name, b.name as branch_name
      FROM inventory_sales i
      LEFT JOIN products p ON i.product_id = p.id
      LEFT JOIN branches b ON i.branch_id = b.id
      WHERE 1=1
    `;
    if (from) { sql += ' AND i.sale_date >= ?'; params.push(from); }
    if (to) { sql += ' AND i.sale_date <= ?'; params.push(to); }
    if (branch_id) { sql += ' AND i.branch_id = ?'; params.push(branch_id); }
    sql += ' ORDER BY i.sale_date DESC';
    data = db.prepare(sql).all(...params);
    filename = `inventory_${from || 'all'}_${to || 'all'}`;
  } else if (module === 'branch_summary') {
    const report = branchSalesPurchasesSummary({ from, to });
    data = report.rows || [];
    filename = `branch_summary_${from || 'all'}_${to || 'all'}`;
  }
  return { data, filename };
}

function dailyCombinedReport({ date, branch_id }) {
  if (!date) {
    const today = new Date().toISOString().slice(0, 10);
    date = today;
  }
  const salesParams = [date];
  let salesSql = `
    SELECT s.*, b.name as branch_name
    FROM sales s
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE s.sale_date = ?
  `;
  if (branch_id) {
    salesSql += ' AND s.branch_id = ?';
    salesParams.push(branch_id);
  }
  const salesRows = db.prepare(salesSql).all(...salesParams);

  const purchParams = [date];
  let purchSql = `
    SELECT p.*, b.name as branch_name, s.name as supplier_name
    FROM purchases p
    LEFT JOIN branches b ON p.branch_id = b.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.purchase_date = ?
  `;
  if (branch_id) {
    purchSql += ' AND p.branch_id = ?';
    purchParams.push(branch_id);
  }
  const purchaseRows = db.prepare(purchSql).all(...purchParams);

  const salesTotal = salesRows.reduce((a, r) => a + (parseFloat(r.net_sales) || 0), 0);
  const purchaseTotal = purchaseRows.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);

  return { date, branch_id: branch_id || null, salesRows, purchaseRows, salesTotal, purchaseTotal };
}

function branchSalesPurchasesSummary({ from, to }) {
  const branches = db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY name').all();
  const byId = new Map();
  branches.forEach((b) => {
    byId.set(b.id, {
      branch_id: b.id,
      branch_name: b.name,
      total_sales: 0,
      cash_sales: 0,
      bank_sales: 0,
      total_purchases: 0,
    });
  });

  const salesWhere = [];
  const salesParams = [];
  if (from) { salesWhere.push('sale_date >= ?'); salesParams.push(from); }
  if (to) { salesWhere.push('sale_date <= ?'); salesParams.push(to); }
  const salesSql = `
    SELECT branch_id,
      COALESCE(SUM(net_sales), 0) as total_sales,
      COALESCE(SUM(cash_amount), 0) as cash_sales,
      COALESCE(SUM(bank_amount), 0) as bank_sales
    FROM sales
    ${salesWhere.length ? `WHERE ${salesWhere.join(' AND ')}` : ''}
    GROUP BY branch_id
  `;
  const salesRows = db.prepare(salesSql).all(...salesParams);
  salesRows.forEach((r) => {
    const row = byId.get(r.branch_id);
    if (!row) return;
    row.total_sales = parseFloat(r.total_sales) || 0;
    row.cash_sales = parseFloat(r.cash_sales) || 0;
    row.bank_sales = parseFloat(r.bank_sales) || 0;
  });

  const purchWhere = [];
  const purchParams = [];
  if (from) { purchWhere.push('purchase_date >= ?'); purchParams.push(from); }
  if (to) { purchWhere.push('purchase_date <= ?'); purchParams.push(to); }
  const purchSql = `
    SELECT branch_id,
      COALESCE(SUM(total_amount), 0) as total_purchases
    FROM purchases
    ${purchWhere.length ? `WHERE ${purchWhere.join(' AND ')}` : ''}
    GROUP BY branch_id
  `;
  const purchRows = db.prepare(purchSql).all(...purchParams);
  purchRows.forEach((r) => {
    const row = byId.get(r.branch_id);
    if (!row) return;
    row.total_purchases = parseFloat(r.total_purchases) || 0;
  });

  const rows = Array.from(byId.values());
  return { from: from || null, to: to || null, rows };
}

router.get('/reports/daily-combined', authenticate, (req, res) => {
  const { date, branch_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const report = dailyCombinedReport({ date, branch_id });
  res.json(report);
});

router.get('/reports/branch-summary', authenticate, (req, res) => {
  const { from, to } = req.query;
  const report = branchSalesPurchasesSummary({ from, to });
  res.json(report);
});

function toCsv(data) {
  const keys = Object.keys(data[0]);
  const header = keys.join(',');
  const rows = data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','));
  return [header, ...rows].join('\n');
}

function writePdf(res, { title, data }) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  doc.pipe(res);
  doc.fontSize(16).text(title, { align: 'left' });
  doc.moveDown(0.5);
  if (!data.length) {
    doc.fontSize(11).text('No data for the selected filters.');
    doc.end();
    return;
  }
  const keys = Object.keys(data[0]);
  const rows = data.map((r) => keys.map((k) => String(r[k] ?? '')).join(' | '));
  doc.fontSize(9).text(keys.join(' | '), { lineGap: 2 });
  doc.moveDown(0.25);
  rows.forEach((line) => doc.text(line, { lineGap: 2 }));
  doc.end();
}

router.get('/export', authenticate, async (req, res) => {
  const { type, module, from, to, branch_id, date } = req.query;
  if (!type || !module) return res.status(400).json({ error: 'type and module required' });
  if (module === 'daily_combined') {
    const report = dailyCombinedReport({ date, branch_id });
    const filename = `daily_combined_${report.date}_${report.branch_id || 'all'}`;

    if (type === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const wsSales = wb.addWorksheet('Sales');
      wsSales.columns = [
        { header: 'Date', key: 'sale_date', width: 12 },
        { header: 'Branch', key: 'branch_name', width: 18 },
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Cash', key: 'cash_amount', width: 12 },
        { header: 'Bank', key: 'bank_amount', width: 12 },
        { header: 'Credit', key: 'credit_amount', width: 12 },
        { header: 'Discount', key: 'discount', width: 12 },
        { header: 'Returns', key: 'returns_amount', width: 12 },
        { header: 'Net sales', key: 'net_sales', width: 14 },
      ];
      wsSales.addRows(report.salesRows);
      wsSales.getRow(1).font = { bold: true };

      const wsPurch = wb.addWorksheet('Purchases');
      wsPurch.columns = [
        { header: 'Date', key: 'purchase_date', width: 12 },
        { header: 'Branch', key: 'branch_name', width: 18 },
        { header: 'Supplier', key: 'supplier_name', width: 20 },
        { header: 'Invoice', key: 'invoice_no', width: 16 },
        { header: 'Total', key: 'total_amount', width: 14 },
        { header: 'Paid', key: 'paid_amount', width: 14 },
        { header: 'Balance', key: 'balance', width: 14 },
      ];
      wsPurch.addRows(report.purchaseRows);
      wsPurch.getRow(1).font = { bold: true };

      const summary = wb.addWorksheet('Summary');
      summary.addRow(['Date', report.date]);
      summary.addRow(['Branch', report.branch_id || 'All']);
      summary.addRow(['Total sales', report.salesTotal]);
      summary.addRow(['Total purchases', report.purchaseTotal]);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    if (type === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      const flat = [
        { section: 'Summary', date: report.date, branch_id: report.branch_id || 'All', salesTotal: report.salesTotal, purchaseTotal: report.purchaseTotal },
        ...report.salesRows.map((s) => ({ section: 'Sales', ...s })),
        ...report.purchaseRows.map((p) => ({ section: 'Purchases', ...p })),
      ];
      return writePdf(res, { title: `Daily combined report — ${report.date}`, data: flat });
    }

    return res.status(400).json({ error: 'Unsupported type for daily_combined. Use xlsx or pdf.' });
  }

  const { data, filename } = buildExportData(module, { from, to, branch_id });

  if (!data.length) {
    if (type === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return writePdf(res, { title: `${module.toUpperCase()} report`, data: [] });
    }
    if (type === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Report');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }
    return res.status(400).json({ error: 'No data to export' });
  }

  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    const keys = Object.keys(data[0]);
    ws.columns = keys.map((k) => ({ header: k, key: k }));
    ws.addRows(data);
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  if (type === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    return writePdf(res, { title: `${module.toUpperCase()} report`, data });
  }
  res.status(400).json({ error: 'Unsupported export type. Use xlsx or pdf.' });
});

export default router;
