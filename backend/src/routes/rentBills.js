import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getCompanySettings, addPdfCompanyHeader, addExcelCompanyHeader } from '../utils/companyBranding.js';

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

// Ledger: all rent/bills with their payments (must be before /:id)
router.get('/ledger', authenticate, (req, res) => {
  const { category } = req.query;
  let sql = 'SELECT * FROM rent_bills WHERE 1=1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY due_date ASC, id DESC';
  const bills = db.prepare(sql).all(...params);
  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    WHERE p.reference_type = 'rent_bill'
    ORDER BY p.payment_date ASC, p.id ASC
  `).all();
  const byBill = {};
  payments.forEach((p) => {
    const id = p.reference_id;
    if (!byBill[id]) byBill[id] = [];
    byBill[id].push(p);
  });
  const items = bills.map((b) => {
    const billPayments = byBill[b.id] || [];
    const totalAmount = parseFloat(b.amount) || 0;
    const totalPaid = parseFloat(b.paid_amount) || 0;
    const balance = totalAmount - totalPaid;
    return { bill: b, payments: billPayments, totalAmount, totalPaid, balance };
  });
  const totalAmount = items.reduce((a, x) => a + x.totalAmount, 0);
  const totalPaid = items.reduce((a, x) => a + x.totalPaid, 0);
  res.json({ items, totalAmount, totalPaid, totalBalance: totalAmount - totalPaid });
});

// Single rent/bill ledger by title (all monthly entries + payments) - same shape as staff ledger
router.get('/:id/ledger', authenticate, (req, res) => {
  const { id } = req.params;
  const bill = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(id);
  if (!bill) return res.status(404).json({ error: 'Rent/Bill not found.' });

  const title = bill.title;
  // All monthly records (processed entries) for this bill title
  const recordsRaw = db.prepare(`
    SELECT * FROM rent_bills
    WHERE title = ? AND due_date IS NOT NULL
    ORDER BY due_date DESC
  `).all(title);

  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name, substr(rb.due_date, 1, 7) as month_year
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    JOIN rent_bills rb ON p.reference_type = 'rent_bill' AND p.reference_id = rb.id
    WHERE rb.title = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(title);

  const monthYear = (dueDate) => dueDate ? String(dueDate).slice(0, 7) : null;
  const byRecord = new Map();
  recordsRaw.forEach((r) => {
    const amt = parseFloat(r.amount) || 0;
    byRecord.set(r.id, {
      id: r.id,
      month_year: monthYear(r.due_date),
      amount: amt,
      paid_amount: 0,
      remaining_amount: amt,
      status: r.status || 'pending',
    });
  });

  payments.forEach((p) => {
    const rec = byRecord.get(p.reference_id);
    if (!rec) return;
    const a = parseFloat(p.amount) || 0;
    rec.paid_amount += a;
  });

  byRecord.forEach((rec) => {
    const amt = rec.amount;
    const paid = rec.paid_amount || 0;
    rec.remaining_amount = Math.max(0, amt - paid);
    rec.status = paid >= amt ? 'paid' : paid > 0 ? 'partial' : 'pending';
  });

  const salaries = Array.from(byRecord.values());
  const totalAmount = salaries.reduce((a, r) => a + r.amount, 0);
  const totalPaid = salaries.reduce((a, r) => a + (r.paid_amount || 0), 0);
  const pending = totalAmount - totalPaid;

  res.json({
    bill: { title: bill.title, category: bill.category },
    salaries,
    payments,
    totalAmount,
    totalPaid,
    pending,
  });
});

router.get('/ledger/export', authenticate, async (req, res) => {
  const { type, category } = req.query;
  if (!type) return res.status(400).json({ error: 'type is required (pdf or xlsx)' });

  let sql = 'SELECT * FROM rent_bills WHERE 1=1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY due_date ASC, id DESC';
  const bills = db.prepare(sql).all(...params);
  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    WHERE p.reference_type = 'rent_bill'
    ORDER BY p.payment_date ASC, p.id ASC
  `).all();
  const byBill = {};
  payments.forEach((p) => {
    const id = p.reference_id;
    if (!byBill[id]) byBill[id] = [];
    byBill[id].push(p);
  });
  const items = bills.map((b) => {
    const billPayments = byBill[b.id] || [];
    const totalAmount = parseFloat(b.amount) || 0;
    const totalPaid = parseFloat(b.paid_amount) || 0;
    const balance = totalAmount - totalPaid;
    return { bill: b, payments: billPayments, totalAmount, totalPaid, balance };
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const scope = category ? (category === 'rent' ? 'rent' : 'bills') : 'all';
  const filename = `rent-bills-ledger-${scope}-${datePart}`;
  const company = getCompanySettings(db);

  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || 'Finance Software';
    const ws = wb.addWorksheet('Rent & Bills Ledger');
    const title = category === 'rent' ? 'Rent Ledger' : category === 'bill' ? 'Bills Ledger' : 'Rent & Bills Ledger';
    addExcelCompanyHeader(ws, company, title, wb);
    ws.addRow(['Title', 'Category', 'Amount', 'Paid', 'Balance', 'Due Date', 'Status']);
    ws.lastRow.font = { bold: true };
    items.forEach((i) => ws.addRow([i.bill.title, i.bill.category || 'bill', i.totalAmount, i.totalPaid, i.balance, i.bill.due_date || '', i.bill.status || 'pending']));
    const summary = wb.addWorksheet('Summary');
    addExcelCompanyHeader(summary, company, title, wb);
    summary.addRow(['Total amount', items.reduce((a, x) => a + x.totalAmount, 0)]);
    summary.addRow(['Total paid', items.reduce((a, x) => a + x.totalPaid, 0)]);
    summary.addRow(['Total balance', items.reduce((a, x) => a + x.balance, 0)]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  if (type === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);
    addPdfCompanyHeader(doc, company, { title: 'Rent & Bills Ledger' });
    doc.fontSize(10).font('Helvetica').text(`Total amount: ${items.reduce((a, x) => a + x.totalAmount, 0).toFixed(2)} | Total paid: ${items.reduce((a, x) => a + x.totalPaid, 0).toFixed(2)} | Balance: ${items.reduce((a, x) => a + x.balance, 0).toFixed(2)}`);
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica').text('Title | Category | Amount | Paid | Balance | Due Date | Status', { lineGap: 2 });
    doc.moveDown(0.25);
    items.forEach((i) => {
      doc.text(
        `${(i.bill.title || '').slice(0, 30)} | ${i.bill.category || 'bill'} | ${i.totalAmount.toFixed(2)} | ${i.totalPaid.toFixed(2)} | ${i.balance.toFixed(2)} | ${i.bill.due_date || '–'} | ${i.bill.status || 'pending'}`,
        { lineGap: 2 }
      );
    });
    doc.end();
    return;
  }

  return res.status(400).json({ error: 'Unsupported type. Use pdf or xlsx.' });
});

// Single rent/bill ledger export (by title - monthly records + payments, same as staff)
router.get('/:id/ledger/export', authenticate, async (req, res) => {
  const { id } = req.params;
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type is required (pdf or xlsx)' });

  const bill = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(id);
  if (!bill) return res.status(404).json({ error: 'Rent/Bill not found.' });

  const title = bill.title;
  const recordsRaw = db.prepare(`
    SELECT * FROM rent_bills
    WHERE title = ? AND due_date IS NOT NULL
    ORDER BY due_date DESC
  `).all(title);

  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name, substr(rb.due_date, 1, 7) as month_year
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    JOIN rent_bills rb ON p.reference_type = 'rent_bill' AND p.reference_id = rb.id
    WHERE rb.title = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(title);

  const monthYear = (d) => d ? String(d).slice(0, 7) : null;
  const byRecord = new Map();
  recordsRaw.forEach((r) => {
    const amt = parseFloat(r.amount) || 0;
    byRecord.set(r.id, { id: r.id, month_year: monthYear(r.due_date), amount: amt, paid_amount: 0, remaining_amount: amt, status: r.status || 'pending' });
  });
  payments.forEach((p) => {
    const rec = byRecord.get(p.reference_id);
    if (rec) rec.paid_amount += parseFloat(p.amount) || 0;
  });
  byRecord.forEach((rec) => {
    rec.remaining_amount = Math.max(0, rec.amount - (rec.paid_amount || 0));
    rec.status = (rec.paid_amount || 0) >= rec.amount ? 'paid' : (rec.paid_amount || 0) > 0 ? 'partial' : 'pending';
  });
  const salaries = Array.from(byRecord.values());
  const totalAmount = salaries.reduce((a, r) => a + r.amount, 0);
  const totalPaid = salaries.reduce((a, r) => a + (r.paid_amount || 0), 0);
  const pending = totalAmount - totalPaid;

  const company = getCompanySettings(db);
  const safeTitle = (title || `rent-bill-${id}`).replace(/\s+/g, '-');
  const filenameBase = `rent-bill-ledger-${safeTitle}`;

  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || 'Finance Software';

    const wsRec = wb.addWorksheet('Monthly records');
    addExcelCompanyHeader(wsRec, company, `Rent/Bill Ledger — ${title}`, wb);
    wsRec.addRow(['Month', 'Amount', 'Paid', 'Remaining', 'Status']);
    wsRec.lastRow.font = { bold: true };
    salaries.forEach((r) => wsRec.addRow([r.month_year || '', r.amount, r.paid_amount || 0, r.remaining_amount, r.status]));

    const wsPay = wb.addWorksheet('Payments');
    addExcelCompanyHeader(wsPay, company, `Payments — ${title}`, wb);
    wsPay.addRow(['Payment Date', 'Month', 'Mode', 'Bank', 'Amount', 'Remarks']);
    wsPay.lastRow.font = { bold: true };
    payments.forEach((p) => {
      wsPay.addRow([p.payment_date, p.month_year || '', p.mode === 'bank' ? 'Bank' : 'Cash', p.bank_name || '', parseFloat(p.amount) || 0, p.remarks || '']);
    });

    const summary = wb.addWorksheet('Summary');
    addExcelCompanyHeader(summary, company, `Ledger — ${title}`, wb);
    summary.addRow(['Total amount', totalAmount]);
    summary.addRow(['Total paid', totalPaid]);
    summary.addRow(['Pending', pending]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  if (type === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
    doc.pipe(res);

    addPdfCompanyHeader(doc, company, { title: 'Rent/Bill Ledger', subtitle: title });
    doc.fontSize(10).font('Helvetica').text(
      `Total amount: ${totalAmount.toFixed(2)}   Paid: ${totalPaid.toFixed(2)}   Pending: ${pending.toFixed(2)}`
    );
    doc.moveDown(0.75);
    doc.fontSize(11).font('Helvetica-Bold').text('Monthly records', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(9).font('Helvetica').text('Month\tAmount\tPaid\tRemaining\tStatus', { lineGap: 2 });
    salaries.forEach((r) => {
      doc.text(`${r.month_year || '–'}\t${r.amount.toFixed(2)}\t${(r.paid_amount || 0).toFixed(2)}\t${r.remaining_amount.toFixed(2)}\t${r.status}`, { lineGap: 2 });
    });
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text('Payments', { underline: true });
    doc.moveDown(0.25);
    if (payments.length) {
      doc.fontSize(9).font('Helvetica').text('Date\tMonth\tMode\tAmount\tRemarks', { lineGap: 2 });
      payments.forEach((p) => {
        doc.text(`${p.payment_date || ''}\t${p.month_year || '–'}\t${p.mode === 'bank' ? 'Bank' : 'Cash'}\t${(parseFloat(p.amount) || 0).toFixed(2)}\t${p.remarks || '–'}`, { lineGap: 2 });
      });
    } else {
      doc.fontSize(9).font('Helvetica').text('No payments yet.');
    }

    doc.end();
    return;
  }

  return res.status(400).json({ error: 'Unsupported type. Use pdf or xlsx.' });
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
    // Simple add: create a base rent/bill definition (no monthly restriction here).
    const r = db.prepare(`
      INSERT INTO rent_bills (title, category, amount, due_date, paid_amount, status, remarks)
      VALUES (?, ?, ?, ?, 0, 'pending', ?)
    `).run(title, category || 'bill', amt, due_date || null, remarks || null);
    res.status(201).json({ id: r.lastInsertRowid, title, amount: amt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Process a monthly cycle for an existing rent/bill entry itself (do not create new rows)
router.post('/:id/process', authenticate, requireNotAuditor, logActivity('process', 'rent_bills', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { month_year, amount } = req.body;
    if (!month_year) return res.status(400).json({ error: 'month_year required (YYYY-MM).' });

    const base = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(id);
    if (!base) return res.status(404).json({ error: 'Rent/Bill not found.' });

    const amt = parseFloat(amount ?? base.amount);
    if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Valid amount required.' });

    const dueDate = `${month_year}-01`;

    // Update this entry to set the month and amount; do not create a new entry
    db.prepare(`
      UPDATE rent_bills
      SET amount = ?, due_date = ?, updated_at = ?
      WHERE id = ?
    `).run(amt, dueDate, new Date().toISOString(), id);

    res.status(200).json({
      id: base.id,
      title: base.title,
      month_year,
      amount: amt,
    });
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
