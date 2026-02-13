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

function cashInHand(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT closing_cash FROM cash_entries WHERE entry_date = ?').all(d);
  return rows.reduce((a, r) => a + (parseFloat(r.closing_cash) || 0), 0);
}

router.get('/', authenticate, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const monthEnd = today.slice(0, 8) + String(lastDay).padStart(2, '0');

  const salesToday = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date = ?').get(today);
  const salesMonth = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?').get(monthStart, monthEnd);
  const purchasesMonth = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?').get(monthStart, monthEnd);
  const expensesMonth = db.prepare('SELECT COALESCE(SUM(amount), 0) as t FROM expenses WHERE expense_date >= ? AND expense_date <= ?').get(monthStart, monthEnd);

  const gross = parseFloat(salesMonth?.t) || 0;
  const cost = parseFloat(purchasesMonth?.t) || 0;
  const exp = parseFloat(expensesMonth?.t) || 0;
  const netProfit = gross - cost - exp;

  const receivables = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t FROM receivables WHERE status = 'pending'
  `).get();
  const payables = db.prepare(`
    SELECT COALESCE(SUM(balance), 0) as t FROM purchases WHERE balance > 0
  `).get();

  const branchSales = db.prepare(`
    SELECT b.id, b.name, COALESCE(SUM(s.net_sales), 0) as total
    FROM branches b
    LEFT JOIN sales s ON s.branch_id = b.id AND s.sale_date >= ? AND s.sale_date <= ?
    WHERE b.is_active = 1
    GROUP BY b.id, b.name
    ORDER BY total DESC
  `).all(monthStart, monthEnd);

  const expenseByCategory = db.prepare(`
    SELECT c.name, COALESCE(SUM(e.amount), 0) as total
    FROM expense_categories c
    LEFT JOIN expenses e ON e.category_id = c.id AND e.expense_date >= ? AND e.expense_date <= ?
    GROUP BY c.id, c.name
    HAVING total > 0
    ORDER BY total DESC
  `).all(monthStart, monthEnd);

  res.json({
    widgets: {
      salesToday: parseFloat(salesToday?.t) || 0,
      salesMonth: parseFloat(salesMonth?.t) || 0,
      netProfit,
      cashInHand: cashInHand(today),
      bankBalance: bankBalance(),
      receivables: parseFloat(receivables?.t) || 0,
      payables: parseFloat(payables?.t) || 0,
    },
    branchComparison: branchSales,
    expenseHeatmap: expenseByCategory,
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
  } else if (module === 'expenses') {
    let sql = 'SELECT e.*, c.name as category_name FROM expenses e LEFT JOIN expense_categories c ON e.category_id = c.id WHERE 1=1';
    if (from) { sql += ' AND e.expense_date >= ?'; params.push(from); }
    if (to) { sql += ' AND e.expense_date <= ?'; params.push(to); }
    if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
    sql += ' ORDER BY e.expense_date DESC';
    data = db.prepare(sql).all(...params);
    filename = `expenses_${from || 'all'}_${to || 'all'}`;
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
  }
  return { data, filename };
}

function toCsv(data) {
  const keys = Object.keys(data[0]);
  const header = keys.join(',');
  const rows = data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','));
  return [header, ...rows].join('\n');
}

function writePdf(res, { title, data }) {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  doc.fontSize(16).text(title, { align: 'left' });
  doc.moveDown(0.5);
  if (!data.length) {
    doc.fontSize(11).text('No data.');
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
  const { type, module, from, to, branch_id } = req.query;
  if (!type || !module) return res.status(400).json({ error: 'type and module required' });
  const { data, filename } = buildExportData(module, { from, to, branch_id });

  if (type === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.json(data);
  }
  if (type === 'csv') {
    if (!data.length) return res.status(400).json({ error: 'No data to export' });
    const csv = toCsv(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(csv);
  }
  if (type === 'xlsx') {
    if (!data.length) return res.status(400).json({ error: 'No data to export' });
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
  res.status(400).json({ error: 'Unsupported export type. Use json, csv, xlsx, or pdf.' });
});

export default router;
