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
const purchasesUploadDir = path.join(__dirname, '../../data/uploads/purchases');
if (!fs.existsSync(purchasesUploadDir)) fs.mkdirSync(purchasesUploadDir, { recursive: true });

const sanitizeName = (name) => (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, purchasesUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/suppliers', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  res.json(rows);
});

router.post('/suppliers', authenticate, requireNotAuditor, logActivity('create', 'suppliers', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, address, phone, vat_number, contact } = req.body;
    const r = db.prepare('INSERT INTO suppliers (name, contact, address, phone, vat_number) VALUES (?, ?, ?, ?, ?)').run(
      name, contact || null, address || null, phone || null, vat_number || null
    );
    res.status(201).json({ id: r.lastInsertRowid, name, address, phone, vat_number });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/suppliers/:id', authenticate, requireNotAuditor, logActivity('update', 'suppliers', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    ['name', 'contact', 'address', 'phone', 'vat_number'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/suppliers/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'suppliers', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const purchaseCount = db.prepare('SELECT COUNT(1) as cnt FROM purchases WHERE supplier_id = ?').get(id)?.cnt || 0;
    const paymentCount = db.prepare("SELECT COUNT(1) as cnt FROM payments WHERE reference_type = 'supplier' AND reference_id = ?").get(id)?.cnt || 0;
    if (purchaseCount > 0 || paymentCount > 0) {
      return res.status(409).json({ error: 'Cannot delete supplier with purchases or payments.' });
    }
    const r = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'Supplier not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/suppliers/:id/ledger', authenticate, (req, res) => {
  const { id } = req.params;
  const purchases = db.prepare(`
    SELECT p.*, b.name as branch_name FROM purchases p
    LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.supplier_id = ? ORDER BY p.purchase_date DESC
  `).all(id);
  const payments = db.prepare(`
    SELECT * FROM payments WHERE reference_type = 'supplier' AND reference_id = ? ORDER BY payment_date DESC
  `).all(id);
  const totalPurchases = purchases.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
  const totalPaid = purchases.reduce((a, r) => a + (parseFloat(r.paid_amount) || 0), 0) +
    payments.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const balance = totalPurchases - totalPaid;
  res.json({ purchases, payments, totalPurchases, totalPaid, balance });
});

router.get('/due-reminders', authenticate, (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 60);
  const rows = db.prepare(`
    SELECT p.*, s.name as supplier_name, b.name as branch_name,
      CASE WHEN p.due_date < date('now') THEN 'overdue' ELSE 'due_soon' END as status
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.balance > 0 AND p.due_date IS NOT NULL AND p.due_date <= date('now', ?)
    ORDER BY p.due_date ASC
  `).all(`+${days} days`);
  res.json({ days, rows });
});

router.get('/', authenticate, (req, res) => {
  const { supplier_id, branch_id, from, to } = req.query;
  let sql = `
    SELECT p.*, s.name as supplier_name, b.name as branch_name
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN branches b ON p.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (supplier_id) { sql += ' AND p.supplier_id = ?'; params.push(supplier_id); }
  if (branch_id) { sql += ' AND p.branch_id = ?'; params.push(branch_id); }
  if (from) { sql += ' AND p.purchase_date >= ?'; params.push(from); }
  if (to) { sql += ' AND p.purchase_date <= ?'; params.push(to); }
  sql += ' ORDER BY p.purchase_date DESC, p.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/reports/daily', authenticate, (req, res) => {
  const { date, branch_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  let sql = `
    SELECT p.*, s.name as supplier_name, b.name as branch_name FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.purchase_date = ?
  `;
  const params = [date];
  if (branch_id) { sql += ' AND p.branch_id = ?'; params.push(branch_id); }
  sql += ' ORDER BY p.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
  res.json({ date, branch_id: branch_id || null, rows, total });
});

router.get('/reports/monthly', authenticate, (req, res) => {
  const { month, year, branch_id } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  let sql = `
    SELECT p.purchase_date, SUM(p.total_amount) as daily_total, p.branch_id, b.name as branch_name
    FROM purchases p LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.purchase_date >= ? AND p.purchase_date <= ?
  `;
  const params = [from, to];
  if (branch_id) { sql += ' AND p.branch_id = ?'; params.push(branch_id); }
  sql += ' GROUP BY p.purchase_date, p.branch_id ORDER BY p.purchase_date, p.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
  res.json({ month, year, from, to, rows, total });
});

router.get('/reports/supplier-wise', authenticate, (req, res) => {
  const { from, to } = req.query;
  const rows = from && to
    ? db.prepare(`
        SELECT s.id, s.name, COALESCE(SUM(p.total_amount), 0) as total_purchases, COALESCE(SUM(p.paid_amount), 0) as total_paid,
               COALESCE(SUM(p.total_amount), 0) - COALESCE(SUM(p.paid_amount), 0) as balance
        FROM suppliers s
        LEFT JOIN purchases p ON p.supplier_id = s.id AND p.purchase_date >= ? AND p.purchase_date <= ?
        GROUP BY s.id, s.name ORDER BY total_purchases DESC
      `).all(from, to)
    : db.prepare(`
        SELECT s.id, s.name, COALESCE(SUM(p.total_amount), 0) as total_purchases, COALESCE(SUM(p.paid_amount), 0) as total_paid,
               COALESCE(SUM(p.total_amount), 0) - COALESCE(SUM(p.paid_amount), 0) as balance
        FROM suppliers s
        LEFT JOIN purchases p ON p.supplier_id = s.id
        GROUP BY s.id, s.name ORDER BY total_purchases DESC
      `).all();
  res.json(rows);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT p.*, s.name as supplier_name, s.contact, b.name as branch_name
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase not found.' });
  const att = db.prepare('SELECT * FROM purchase_attachments WHERE purchase_id = ?').all(row.id);
  const attachments = att.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null }));
  res.json({ ...row, attachments });
});

router.get('/:id/attachments', authenticate, (req, res) => {
  const purchase = db.prepare('SELECT id FROM purchases WHERE id = ?').get(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
  const rows = db.prepare('SELECT * FROM purchase_attachments WHERE purchase_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(rows.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null })));
});

router.post('/:id/attachments', authenticate, requireNotAuditor, upload.array('files', 10), logActivity('attach', 'purchases', req => req.params.id), (req, res) => {
  try {
    const purchase = db.prepare('SELECT id FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded.' });
    const stmt = db.prepare('INSERT INTO purchase_attachments (purchase_id, filename, path) VALUES (?, ?, ?)');
    const inserted = [];
    for (const f of files) {
      const relPath = `purchases/${f.filename}`;
      const r = stmt.run(purchase.id, f.originalname, relPath);
      inserted.push({ id: r.lastInsertRowid, filename: f.originalname, path: relPath, url: `/uploads/${relPath}` });
    }
    res.status(201).json({ ok: true, attachments: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/attachments/:attId', authenticate, requireNotAuditor, logActivity('delete_attachment', 'purchases', req => req.params.attId), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM purchase_attachments WHERE id = ? AND purchase_id = ?').get(req.params.attId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    if (row.path) {
      const filePath = path.join(__dirname, '../../data/uploads', row.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM purchase_attachments WHERE id = ?').run(req.params.attId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'purchases', req => req.body?.invoice_no || ''), (req, res) => {
  try {
    const { supplier_id, branch_id, invoice_no, purchase_date, due_date, total_amount, paid_amount, remarks } = req.body;
    let inv = invoice_no || null;
    if (!inv) {
      const prefix = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('invoice_prefix')?.value || 'INV';
      const counterRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('invoice_counter');
      const next = parseInt(counterRow?.value || '1', 10);
      inv = `${prefix}-${String(next).padStart(6, '0')}`;
      db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('invoice_counter', String(next + 1));
    }
    const total = parseFloat(total_amount) || 0;
    const paid = parseFloat(paid_amount) || 0;
    const balance = total - paid;
    const r = db.prepare(`
      INSERT INTO purchases (supplier_id, branch_id, invoice_no, purchase_date, due_date, total_amount, paid_amount, balance, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(supplier_id, branch_id || null, inv, purchase_date, due_date || null, total, paid, balance, remarks || null);
    res.status(201).json({ id: r.lastInsertRowid, invoice_no: inv, total_amount: total, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireNotAuditor, logActivity('update', 'purchases', req => req.params.id), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Purchase not found.' });
    const { supplier_id, branch_id, invoice_no, purchase_date, due_date, total_amount, paid_amount, remarks } = req.body;
    const total = total_amount !== undefined ? parseFloat(total_amount) : parseFloat(existing.total_amount);
    const paid = paid_amount !== undefined ? parseFloat(paid_amount) : parseFloat(existing.paid_amount);
    const balance = total - paid;
    db.prepare(`
      UPDATE purchases SET supplier_id=?, branch_id=?, invoice_no=?, purchase_date=?, due_date=?, total_amount=?, paid_amount=?, balance=?, remarks=?
      WHERE id=?
    `).run(
      supplier_id ?? existing.supplier_id,
      branch_id !== undefined ? branch_id : existing.branch_id,
      invoice_no !== undefined ? invoice_no : existing.invoice_no,
      purchase_date ?? existing.purchase_date,
      due_date !== undefined ? due_date : existing.due_date,
      total,
      paid,
      balance,
      remarks !== undefined ? remarks : existing.remarks,
      req.params.id
    );
    res.json({ ok: true, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/pay', authenticate, requireNotAuditor, logActivity('payment', 'purchases', req => req.params.id), (req, res) => {
  try {
    const p = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Purchase not found.' });
    const amt = parseFloat(req.body.amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const newPaid = (parseFloat(p.paid_amount) || 0) + amt;
    const balance = Math.max(0, (parseFloat(p.total_amount) || 0) - newPaid);
    db.prepare('UPDATE purchases SET paid_amount = ?, balance = ? WHERE id = ?').run(newPaid, balance, p.id);
    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(req.body.remarks, voucher);
    db.prepare(`
      INSERT INTO payments (type, reference_id, reference_type, amount, payment_date, mode, bank_id, remarks)
      VALUES ('supplier', ?, 'supplier', ?, ?, ?, ?, ?)
    `).run(p.supplier_id, amt, req.body.payment_date || new Date().toISOString().slice(0, 10), req.body.mode || 'cash', req.body.bank_id || null, voucherRemarks || null);
    res.json({ ok: true, paid_amount: newPaid, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'purchases', req => req.params.id), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM purchases WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Purchase not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
