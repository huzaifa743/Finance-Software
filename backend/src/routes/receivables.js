import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

router.get('/customers', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM customers ORDER BY name').all();
  res.json(rows);
});

router.post('/customers', authenticate, requireNotAuditor, logActivity('create', 'customers', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, contact, address } = req.body;
    const r = db.prepare('INSERT INTO customers (name, contact, address) VALUES (?, ?, ?)').run(name, contact || null, address || null);
    res.status(201).json({ id: r.lastInsertRowid, name, contact, address });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/customers/:id', authenticate, requireNotAuditor, logActivity('update', 'customers', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact, address } = req.body;
    const updates = [];
    const params = [];
    ['name', 'contact', 'address'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', authenticate, (req, res) => {
  const { customer_id, branch_id, status } = req.query;
  let sql = `
    SELECT r.*, c.name as customer_name, c.contact, b.name as branch_name
    FROM receivables r
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN branches b ON r.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (customer_id) { sql += ' AND r.customer_id = ?'; params.push(customer_id); }
  if (branch_id) { sql += ' AND r.branch_id = ?'; params.push(branch_id); }
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  sql += ' ORDER BY r.due_date ASC, r.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/ledger/:customerId', authenticate, (req, res) => {
  const { customerId } = req.params;
  const receivables = db.prepare(`
    SELECT r.*, b.name as branch_name FROM receivables r
    LEFT JOIN branches b ON r.branch_id = b.id
    WHERE r.customer_id = ? ORDER BY r.created_at DESC
  `).all(customerId);
  const recoveries = db.prepare(`
    SELECT rr.*, r.amount as original_amount FROM receivable_recoveries rr
    JOIN receivables r ON rr.receivable_id = r.id
    WHERE r.customer_id = ? ORDER BY rr.recovered_at DESC
  `).all(customerId);
  const totalDue = receivables
    .filter(r => r.status === 'pending')
    .reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const recoveredTotal = recoveries.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  res.json({ receivables, recoveries, totalDue, recoveredTotal });
});

router.get('/overdue', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, c.name as customer_name, c.contact, b.name as branch_name
    FROM receivables r
    LEFT JOIN customers c ON r.customer_id = c.id
    LEFT JOIN branches b ON r.branch_id = b.id
    WHERE r.status = 'pending' AND r.due_date IS NOT NULL AND r.due_date < date('now')
    ORDER BY r.due_date
  `).all();
  res.json(rows);
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'receivables', req => req.body?.amount || ''), (req, res) => {
  try {
    const { customer_id, sale_id, branch_id, amount, due_date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const r = db.prepare(`
      INSERT INTO receivables (customer_id, sale_id, branch_id, amount, due_date, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(customer_id, sale_id || null, branch_id || null, amt, due_date || null);
    res.status(201).json({ id: r.lastInsertRowid, amount: amt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/recover', authenticate, requireNotAuditor, logActivity('recovery', 'receivables', req => `${req.params.id}`), (req, res) => {
  try {
    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Receivable not found.' });
    const amt = parseFloat(req.body.amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const remaining = parseFloat(rec.amount) - amt;
    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(req.body.remarks, voucher);
    db.prepare('INSERT INTO receivable_recoveries (receivable_id, amount, remarks) VALUES (?, ?, ?)').run(
      rec.id,
      amt,
      voucherRemarks || null
    );
    const newStatus = remaining <= 0 ? 'recovered' : 'partial';
    db.prepare('UPDATE receivables SET amount = ?, status = ? WHERE id = ?').run(
      Math.max(0, remaining),
      newStatus,
      rec.id
    );
    res.json({ ok: true, remaining: Math.max(0, remaining), status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireNotAuditor, logActivity('update', 'receivables', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { due_date, status } = req.body;
    const updates = [];
    const params = [];
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE receivables SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
