import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

router.get('/', authenticate, (req, res) => {
  const { branch_id, from, to } = req.query;
  let sql = `
    SELECT c.*, b.name as branch_name FROM cash_entries c
    LEFT JOIN branches b ON c.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (branch_id) { sql += ' AND c.branch_id = ?'; params.push(branch_id); }
  if (from) { sql += ' AND c.entry_date >= ?'; params.push(from); }
  if (to) { sql += ' AND c.entry_date <= ?'; params.push(to); }
  sql += ' ORDER BY c.entry_date DESC, c.branch_id';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/branch-summary', authenticate, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT c.*, b.name as branch_name FROM cash_entries c
    LEFT JOIN branches b ON c.branch_id = b.id
    WHERE c.entry_date = ?
    ORDER BY c.branch_id
  `).all(d);
  const totalOpening = rows.reduce((a, r) => a + (parseFloat(r.opening_cash) || 0), 0);
  const totalClosing = rows.reduce((a, r) => a + (parseFloat(r.closing_cash) || 0), 0);
  res.json({ date: d, rows, totalOpening, totalClosing });
});

router.get('/difference-alerts', authenticate, (req, res) => {
  const { date } = req.query;
  const d = date || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT c.*, b.name as branch_name FROM cash_entries c
    LEFT JOIN branches b ON c.branch_id = b.id
    WHERE c.entry_date = ? AND c.difference != 0 AND c.difference IS NOT NULL
    ORDER BY ABS(c.difference) DESC
  `).all(d);
  res.json({ date: d, rows });
});

router.get('/:branchId/:date', authenticate, (req, res) => {
  const { branchId, date } = req.params;
  const row = db.prepare(`
    SELECT c.*, b.name as branch_name FROM cash_entries c
    LEFT JOIN branches b ON c.branch_id = b.id
    WHERE c.branch_id = ? AND c.entry_date = ?
  `).get(branchId, date);
  if (!row) return res.status(404).json({ error: 'Cash entry not found.' });
  res.json(row);
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'cash', req => req.body?.entry_date || ''), (req, res) => {
  try {
    const { branch_id, entry_date, opening_cash, sales_cash, expense_cash, bank_deposit, bank_withdrawal, closing_cash, remarks } = req.body;
    const open = parseFloat(opening_cash) || 0;
    const sales = parseFloat(sales_cash) || 0;
    const exp = parseFloat(expense_cash) || 0;
    const dep = parseFloat(bank_deposit) || 0;
    const wit = parseFloat(bank_withdrawal) || 0;
    const close = parseFloat(closing_cash);
    const expected = open + sales - exp - dep + wit;
    const diff = close != null && !isNaN(close) ? close - expected : 0;
    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(remarks, voucher);
    const r = db.prepare(`
      INSERT INTO cash_entries (branch_id, entry_date, opening_cash, closing_cash, sales_cash, expense_cash, bank_deposit, bank_withdrawal, difference, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(branch_id || null, entry_date, open, close ?? expected, sales, exp, dep, wit, diff, voucherRemarks || null);
    res.status(201).json({ id: r.lastInsertRowid, expectedClosing: expected, difference: diff });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Cash entry already exists for this branch and date.' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:branchId/:date', authenticate, requireNotAuditor, logActivity('update', 'cash', req => `${req.params.branchId}/${req.params.date}`), (req, res) => {
  try {
    const { branchId, date } = req.params;
    const { opening_cash, sales_cash, expense_cash, bank_deposit, bank_withdrawal, closing_cash, remarks } = req.body;
    const existing = db.prepare('SELECT * FROM cash_entries WHERE branch_id = ? AND entry_date = ?').get(branchId, date);
    if (!existing) return res.status(404).json({ error: 'Cash entry not found.' });
    const open = opening_cash !== undefined ? parseFloat(opening_cash) || 0 : parseFloat(existing.opening_cash) || 0;
    const sales = sales_cash !== undefined ? parseFloat(sales_cash) || 0 : parseFloat(existing.sales_cash) || 0;
    const exp = expense_cash !== undefined ? parseFloat(expense_cash) || 0 : parseFloat(existing.expense_cash) || 0;
    const dep = bank_deposit !== undefined ? parseFloat(bank_deposit) || 0 : parseFloat(existing.bank_deposit) || 0;
    const wit = bank_withdrawal !== undefined ? parseFloat(bank_withdrawal) || 0 : parseFloat(existing.bank_withdrawal) || 0;
    const close = closing_cash !== undefined ? parseFloat(closing_cash) : parseFloat(existing.closing_cash);
    const expected = open + sales - exp - dep + wit;
    const diff = close != null && !isNaN(close) ? close - expected : 0;
    db.prepare(`
      UPDATE cash_entries SET opening_cash=?, closing_cash=?, sales_cash=?, expense_cash=?, bank_deposit=?, bank_withdrawal=?, difference=?, remarks=?
      WHERE branch_id=? AND entry_date=?
    `).run(open, close ?? expected, sales, exp, dep, wit, diff, remarks !== undefined ? remarks : existing.remarks, branchId, date);
    res.json({ ok: true, expectedClosing: expected, difference: diff });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
