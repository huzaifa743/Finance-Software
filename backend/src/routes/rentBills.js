import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../../data/uploads/rent_bills');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const sanitizeName = (name) => (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/', authenticate, (req, res) => {
  const { category, status } = req.query;
  let sql = 'SELECT * FROM rent_bills WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY due_date ASC, id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Rent/Bill not found.' });
  const att = db.prepare('SELECT * FROM rent_bill_attachments WHERE rent_bill_id = ?').all(row.id);
  const attachments = att.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null }));
  res.json({ ...row, attachments });
});

router.get('/:id/attachments', authenticate, (req, res) => {
  const rb = db.prepare('SELECT id FROM rent_bills WHERE id = ?').get(req.params.id);
  if (!rb) return res.status(404).json({ error: 'Rent/Bill not found.' });
  const rows = db.prepare('SELECT * FROM rent_bill_attachments WHERE rent_bill_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(rows.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null })));
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'rent_bills', req => req.body?.title || ''), (req, res) => {
  try {
    const { title, category, amount, due_date, remarks } = req.body;
    const amt = parseFloat(amount);
    if (!title || amt === undefined || isNaN(amt)) return res.status(400).json({ error: 'Title and amount required.' });
    const r = db.prepare(`
      INSERT INTO rent_bills (title, category, amount, due_date, paid_amount, status, remarks)
      VALUES (?, ?, ?, ?, 0, 'pending', ?)
    `).run(title, category || 'bill', amt, due_date || null, remarks || null);
    res.status(201).json({ id: r.lastInsertRowid, title, amount: amt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireNotAuditor, logActivity('update', 'rent_bills', req => req.params.id), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Rent/Bill not found.' });
    const { title, category, amount, due_date, remarks } = req.body;
    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (amount !== undefined) { updates.push('amount = ?'); params.push(parseFloat(amount)); }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date); }
    if (remarks !== undefined) { updates.push('remarks = ?'); params.push(remarks); }
    if (updates.length) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(req.params.id);
      db.prepare(`UPDATE rent_bills SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/attachments', authenticate, requireNotAuditor, upload.array('files', 10), logActivity('attach', 'rent_bills', req => req.params.id), (req, res) => {
  try {
    const rb = db.prepare('SELECT id FROM rent_bills WHERE id = ?').get(req.params.id);
    if (!rb) return res.status(404).json({ error: 'Rent/Bill not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded.' });
    const stmt = db.prepare('INSERT INTO rent_bill_attachments (rent_bill_id, filename, path) VALUES (?, ?, ?)');
    const inserted = [];
    for (const f of files) {
      const relPath = `rent_bills/${f.filename}`;
      const r = stmt.run(rb.id, f.originalname, relPath);
      inserted.push({ id: r.lastInsertRowid, filename: f.originalname, path: relPath, url: `/uploads/${relPath}` });
    }
    res.status(201).json({ ok: true, attachments: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/attachments/:attId', authenticate, requireNotAuditor, logActivity('delete_attachment', 'rent_bills', req => req.params.attId), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM rent_bill_attachments WHERE id = ? AND rent_bill_id = ?').get(req.params.attId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    if (row.path) {
      const filePath = path.join(__dirname, '../../data/uploads', row.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM rent_bill_attachments WHERE id = ?').run(req.params.attId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'rent_bills', req => req.params.id), (req, res) => {
  try {
    const id = req.params.id;
    const att = db.prepare('SELECT * FROM rent_bill_attachments WHERE rent_bill_id = ?').all(id);
    for (const a of att) {
      if (a.path) {
        const filePath = path.join(__dirname, '../../data/uploads', a.path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.prepare('DELETE FROM rent_bill_attachments WHERE rent_bill_id = ?').run(id);
    const r = db.prepare('DELETE FROM rent_bills WHERE id = ?').run(id);
    if (r.changes === 0) return res.status(404).json({ error: 'Rent/Bill not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
