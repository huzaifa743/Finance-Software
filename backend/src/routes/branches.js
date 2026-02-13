import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

router.get('/', authenticate, (req, res) => {
  const activeOnly = req.query.active === '1';
  let sql = `
    SELECT b.*, u.name as manager_name, u.email as manager_email
    FROM branches b LEFT JOIN users u ON b.manager_user_id = u.id
  `;
  if (activeOnly) sql += ' WHERE b.is_active = 1';
  sql += ' ORDER BY COALESCE(b.code, b.name)';
  const rows = db.prepare(sql).all();
  res.json(rows);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT b.*, u.name as manager_name, u.email as manager_email
    FROM branches b LEFT JOIN users u ON b.manager_user_id = u.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Branch not found.' });
  res.json(row);
});

router.get('/:id/performance', authenticate, (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;
  let where = 'branch_id = ?';
  const params = [id];
  if (from) { where += ' AND sale_date >= ?'; params.push(from); }
  if (to) { where += ' AND sale_date <= ?'; params.push(to); }
  const sales = db.prepare(`
    SELECT COALESCE(SUM(net_sales), 0) as total_sales, COUNT(*) as count
    FROM sales WHERE ${where}
  `).get(...params);
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_expenses
    FROM expenses WHERE branch_id = ? ${from ? 'AND expense_date >= ?' : ''} ${to ? 'AND expense_date <= ?' : ''}
  `).get(...[id, from, to].filter(Boolean));
  res.json({
    total_sales: sales?.total_sales ?? 0,
    sales_count: sales?.count ?? 0,
    total_expenses: expenses?.total_expenses ?? 0,
  });
});

router.post('/', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'branches', req => req.body?.name || ''), (req, res) => {
  try {
    const { code, name, location, manager_user_id, opening_date, closing_date, opening_cash, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    const r = db.prepare(`
      INSERT INTO branches (code, name, location, manager_user_id, opening_date, closing_date, opening_cash, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code || null,
      name,
      location || null,
      manager_user_id || null,
      opening_date || null,
      closing_date || null,
      opening_cash ?? 0,
      is_active !== false ? 1 : 0
    );
    res.status(201).json({ id: r.lastInsertRowid, code: code || null, name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Branch code already exists.' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'branches', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, location, manager_user_id, opening_date, closing_date, opening_cash, is_active } = req.body;
    const updates = [];
    const params = [];
    ['code', 'name', 'location', 'manager_user_id', 'opening_date', 'closing_date', 'opening_cash'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'No updates provided.' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE branches SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Branch code already exists.' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('Super Admin'), logActivity('delete', 'branches', req => req.params.id), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Branch not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
