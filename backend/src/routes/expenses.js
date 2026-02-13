import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const expensesUploadDir = path.join(__dirname, '../../data/uploads/expenses');
if (!fs.existsSync(expensesUploadDir)) fs.mkdirSync(expensesUploadDir, { recursive: true });

const sanitizeName = (name) => (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, expensesUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/categories', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM expense_categories ORDER BY name').all();
  res.json(rows);
});

router.post('/categories', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'expense_categories', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, type } = req.body;
    const r = db.prepare('INSERT INTO expense_categories (name, type) VALUES (?, ?)').run(name, type || 'variable');
    res.status(201).json({ id: r.lastInsertRowid, name, type: type || 'variable' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/categories/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'expense_categories', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { name, type } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE expense_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/categories/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'expense_categories', req => req.params.id), (req, res) => {
  try {
    db.prepare('UPDATE expenses SET category_id = NULL WHERE category_id = ?').run(req.params.id);
    const r = db.prepare('DELETE FROM expense_categories WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Category not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', authenticate, (req, res) => {
  const { branch_id, category_id, from, to, type } = req.query;
  let sql = `
    SELECT e.*, c.name as category_name, c.type as category_type, b.name as branch_name
    FROM expenses e
    LEFT JOIN expense_categories c ON e.category_id = c.id
    LEFT JOIN branches b ON e.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
  if (category_id) { sql += ' AND e.category_id = ?'; params.push(category_id); }
  if (from) { sql += ' AND e.expense_date >= ?'; params.push(from); }
  if (to) { sql += ' AND e.expense_date <= ?'; params.push(to); }
  if (type) { sql += ' AND e.type = ?'; params.push(type); }
  sql += ' ORDER BY e.expense_date DESC, e.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/reports/daily', authenticate, (req, res) => {
  const { date, branch_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  let sql = `
    SELECT e.*, c.name as category_name, b.name as branch_name FROM expenses e
    LEFT JOIN expense_categories c ON e.category_id = c.id
    LEFT JOIN branches b ON e.branch_id = b.id
    WHERE e.expense_date = ?
  `;
  const params = [date];
  if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
  sql += ' ORDER BY e.branch_id, e.category_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  res.json({ date, branch_id: branch_id || null, rows, total });
});

router.get('/reports/monthly', authenticate, (req, res) => {
  const { month, year, branch_id } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  let sql = `
    SELECT e.expense_date, SUM(e.amount) as daily_total, e.branch_id, b.name as branch_name
    FROM expenses e LEFT JOIN branches b ON e.branch_id = b.id
    WHERE e.expense_date >= ? AND e.expense_date <= ?
  `;
  const params = [from, to];
  if (branch_id) { sql += ' AND e.branch_id = ?'; params.push(branch_id); }
  sql += ' GROUP BY e.expense_date, e.branch_id ORDER BY e.expense_date, e.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
  res.json({ month, year, from, to, rows, total });
});

router.get('/reports/category-wise', authenticate, (req, res) => {
  const { from, to, branch_id } = req.query;
  let sql = `
    SELECT c.id, c.name, c.type, SUM(e.amount) as total
    FROM expense_categories c
    LEFT JOIN expenses e ON e.category_id = c.id
  `;
  const params = [];
  const conditions = [];
  if (from) { conditions.push('e.expense_date >= ?'); params.push(from); }
  if (to) { conditions.push('e.expense_date <= ?'); params.push(to); }
  if (branch_id) { conditions.push('e.branch_id = ?'); params.push(branch_id); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' GROUP BY c.id, c.name, c.type ORDER BY total DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/reports/expense-vs-sales', authenticate, (req, res) => {
  const { month, year, branch_id } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  let expSql = `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date >= ? AND expense_date <= ?`;
  const expParams = [from, to];
  if (branch_id) { expSql += ' AND branch_id = ?'; expParams.push(branch_id); }
  const exp = db.prepare(expSql).get(...expParams);
  let salesSql = `SELECT COALESCE(SUM(net_sales), 0) as total FROM sales WHERE sale_date >= ? AND sale_date <= ?`;
  const salesParams = [from, to];
  if (branch_id) { salesSql += ' AND branch_id = ?'; salesParams.push(branch_id); }
  const sales = db.prepare(salesSql).get(...salesParams);
  const expenseTotal = parseFloat(exp?.total) || 0;
  const salesTotal = parseFloat(sales?.total) || 0;
  const ratio = salesTotal > 0 ? (expenseTotal / salesTotal * 100).toFixed(2) : 0;
  res.json({ month, year, from, to, expenseTotal, salesTotal, expenseRatio: parseFloat(ratio) });
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT e.*, c.name as category_name, b.name as branch_name
    FROM expenses e
    LEFT JOIN expense_categories c ON e.category_id = c.id
    LEFT JOIN branches b ON e.branch_id = b.id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Expense not found.' });
  const att = db.prepare('SELECT * FROM expense_attachments WHERE expense_id = ?').all(row.id);
  const attachments = att.map((a) => ({
    ...a,
    url: a.path ? `/uploads/${a.path}` : null,
  }));
  res.json({ ...row, attachments });
});

router.get('/:id/attachments', authenticate, (req, res) => {
  const exp = db.prepare('SELECT id FROM expenses WHERE id = ?').get(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Expense not found.' });
  const rows = db.prepare('SELECT * FROM expense_attachments WHERE expense_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(rows.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null })));
});

router.post('/:id/attachments', authenticate, requireNotAuditor, upload.array('files', 10), logActivity('attach', 'expenses', req => req.params.id), (req, res) => {
  try {
    const exp = db.prepare('SELECT id FROM expenses WHERE id = ?').get(req.params.id);
    if (!exp) return res.status(404).json({ error: 'Expense not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded.' });
    const stmt = db.prepare('INSERT INTO expense_attachments (expense_id, filename, path) VALUES (?, ?, ?)');
    const inserted = [];
    for (const f of files) {
      const relPath = `expenses/${f.filename}`;
      const r = stmt.run(exp.id, f.originalname, relPath);
      inserted.push({ id: r.lastInsertRowid, filename: f.originalname, path: relPath, url: `/uploads/${relPath}` });
    }
    res.status(201).json({ ok: true, attachments: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/attachments/:attId', authenticate, requireNotAuditor, logActivity('delete_attachment', 'expenses', req => req.params.attId), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM expense_attachments WHERE id = ? AND expense_id = ?').get(req.params.attId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    if (row.path) {
      const filePath = path.join(__dirname, '../../data/uploads', row.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM expense_attachments WHERE id = ?').run(req.params.attId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'expenses', req => req.body?.amount || ''), (req, res) => {
  try {
    const { branch_id, category_id, amount, expense_date, type, is_recurring, remarks, status } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(remarks, voucher);
    const r = db.prepare(`
      INSERT INTO expenses (branch_id, category_id, amount, expense_date, type, is_recurring, remarks, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branch_id || null,
      category_id || null,
      amt,
      expense_date,
      type || 'variable',
      is_recurring ? 1 : 0,
      voucherRemarks || null,
      status || 'approved'
    );
    res.status(201).json({ id: r.lastInsertRowid, amount: amt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireNotAuditor, logActivity('update', 'expenses', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, category_id, amount, expense_date, type, is_recurring, remarks, status } = req.body;
    const updates = [];
    const params = [];
    ['branch_id', 'category_id', 'amount', 'expense_date', 'type', 'remarks', 'status'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (is_recurring !== undefined) { updates.push('is_recurring = ?'); params.push(is_recurring ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'expenses', req => req.params.id), (req, res) => {
  try {
    const att = db.prepare('SELECT * FROM expense_attachments WHERE expense_id = ?').all(req.params.id);
    for (const a of att) {
      if (a.path) {
        const filePath = path.join(__dirname, '../../data/uploads', a.path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.prepare('DELETE FROM expense_attachments WHERE expense_id = ?').run(req.params.id);
    const r = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
