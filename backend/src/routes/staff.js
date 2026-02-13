import { Router } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const brandingDir = path.join(__dirname, '../../data/branding');

const getAssetPath = (fileName) => {
  const p = path.join(brandingDir, fileName);
  return fs.existsSync(p) ? p : null;
};

router.get('/', authenticate, (req, res) => {
  const { branch_id } = req.query;
  let sql = `
    SELECT s.*, b.name as branch_name FROM staff s
    LEFT JOIN branches b ON s.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  sql += ' ORDER BY s.name';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT s.*, b.name as branch_name FROM staff s
    LEFT JOIN branches b ON s.branch_id = b.id WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Staff not found.' });
  const salaries = db.prepare('SELECT * FROM salary_records WHERE staff_id = ? ORDER BY month_year DESC').all(row.id);
  res.json({ ...row, salary_records: salaries });
});

router.post('/', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'staff', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, branch_id, fixed_salary, commission_rate, contact, joined_date } = req.body;
    const r = db.prepare(`
      INSERT INTO staff (name, branch_id, fixed_salary, commission_rate, contact, joined_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name,
      branch_id || null,
      parseFloat(fixed_salary) || 0,
      parseFloat(commission_rate) || 0,
      contact || null,
      joined_date || null
    );
    res.status(201).json({ id: r.lastInsertRowid, name, branch_id, fixed_salary: parseFloat(fixed_salary) || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'staff', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    ['name', 'branch_id', 'fixed_salary', 'commission_rate', 'contact', 'joined_date'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE staff SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/salary', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('salary', 'staff', req => req.params.id), (req, res) => {
  try {
    const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
    if (!staff) return res.status(404).json({ error: 'Staff not found.' });
    const { month_year, base_salary, commission, advances, deductions } = req.body;
    const base = (parseFloat(base_salary) ?? parseFloat(staff.fixed_salary)) || 0;
    const comm = parseFloat(commission) || 0;
    const adv = parseFloat(advances) || 0;
    const ded = parseFloat(deductions) || 0;
    const net = base + comm - adv - ded;
    const r = db.prepare(`
      INSERT INTO salary_records (staff_id, month_year, base_salary, commission, advances, deductions, net_salary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processed')
    `).run(staff.id, month_year, base, comm, adv, ded, net);
    res.status(201).json({ id: r.lastInsertRowid, net_salary: net });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/salary/expense', authenticate, (req, res) => {
  const { month_year } = req.query;
  if (!month_year) return res.status(400).json({ error: 'month_year required (YYYY-MM)' });
  const rows = db.prepare(`
    SELECT sr.*, s.name as staff_name, s.branch_id, b.name as branch_name
    FROM salary_records sr
    JOIN staff s ON sr.staff_id = s.id
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE sr.month_year = ? AND sr.status = 'processed'
  `).all(month_year);
  const total = rows.reduce((a, r) => a + (parseFloat(r.net_salary) || 0), 0);
  res.json({ month_year, rows, total });
});

router.get('/salary/:id/slip', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const format = (req.query.format || 'a4').toLowerCase();
    const row = db.prepare(`
      SELECT sr.*, s.name as staff_name, s.contact, b.name as branch_name
      FROM salary_records sr
      JOIN staff s ON sr.staff_id = s.id
      LEFT JOIN branches b ON s.branch_id = b.id
      WHERE sr.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Salary record not found.' });

    const isThermal = format === 'thermal';
    const doc = isThermal
      ? new PDFDocument({ size: [226, 700], margin: 12 })
      : new PDFDocument({ size: 'A4', margin: 36 });

    res.setHeader('Content-Type', 'application/pdf');
    const fileName = `salary-slip-${row.staff_name}-${row.month_year}-${format}.pdf`.replace(/\s+/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    const title = 'Salary Slip';
    const logoPath = getAssetPath('logo.png');
    const signaturePath = getAssetPath('signature.png');
    const stampPath = getAssetPath('stamp.png');
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    if (logoPath) {
      const logoWidth = isThermal ? 120 : 180;
      const logoHeight = isThermal ? 40 : 60;
      const x = doc.page.margins.left + (contentWidth - logoWidth) / 2;
      doc.image(logoPath, x, doc.y, { fit: [logoWidth, logoHeight] });
      doc.y += logoHeight + 8;
    }

    doc.fontSize(isThermal ? 14 : 18).text('Finance Software', { align: 'left' });
    doc.moveDown(0.25);
    doc.fontSize(isThermal ? 11 : 14).text(title, { align: 'left' });
    doc.moveDown(0.25);
    doc.fontSize(isThermal ? 9 : 11).text(`Month: ${row.month_year}`);
    doc.text(`Staff: ${row.staff_name}`);
    if (row.branch_name) doc.text(`Branch: ${row.branch_name}`);
    if (row.contact) doc.text(`Contact: ${row.contact}`);
    doc.moveDown(0.5);

    const line = (label, value) => {
      doc.fontSize(isThermal ? 9 : 11).text(`${label}: ${value}`);
    };

    line('Base Salary', row.base_salary ?? 0);
    line('Commission', row.commission ?? 0);
    line('Advances', row.advances ?? 0);
    line('Deductions', row.deductions ?? 0);
    doc.moveDown(0.25);
    doc.fontSize(isThermal ? 10 : 12).text(`Net Salary: ${row.net_salary ?? 0}`, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(isThermal ? 8 : 10).text(`Generated: ${new Date().toISOString().slice(0, 10)}`);

    const footerY = doc.page.height - doc.page.margins.bottom - (isThermal ? 70 : 100);
    const sigWidth = isThermal ? 80 : 120;
    const stampWidth = isThermal ? 80 : 120;

    if (signaturePath) {
      const sigX = doc.page.margins.left;
      doc.image(signaturePath, sigX, footerY, { fit: [sigWidth, isThermal ? 30 : 50] });
      doc.fontSize(isThermal ? 7 : 9).text('Signature', sigX, footerY + (isThermal ? 34 : 54));
    }

    if (stampPath) {
      const stampX = doc.page.width - doc.page.margins.right - stampWidth;
      doc.image(stampPath, stampX, footerY, { fit: [stampWidth, isThermal ? 40 : 60] });
      doc.fontSize(isThermal ? 7 : 9).text('Stamp', stampX, footerY + (isThermal ? 44 : 64));
    }

    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
