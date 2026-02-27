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

// Single rent/bill ledger (one entry with its payments) - /:id/ledger
router.get('/:id/ledger', authenticate, (req, res) => {
  const { id } = req.params;
  const bill = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(id);
  if (!bill) return res.status(404).json({ error: 'Rent/Bill not found.' });

  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    WHERE p.reference_type = 'rent_bill' AND p.reference_id = ?
    ORDER BY p.payment_date ASC, p.id ASC
  `).all(id);

  const totalAmount = parseFloat(bill.amount) || 0;
  const totalPaid = bill.paid_amount != null
    ? (parseFloat(bill.paid_amount) || 0)
    : payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
  const balance = totalAmount - totalPaid;

  res.json({ bill, payments, totalAmount, totalPaid, balance });
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

// Single rent/bill ledger export (one entry) - /:id/ledger/export
router.get('/:id/ledger/export', authenticate, async (req, res) => {
  const { id } = req.params;
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type is required (pdf or xlsx)' });

  const bill = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(id);
  if (!bill) return res.status(404).json({ error: 'Rent/Bill not found.' });

  const payments = db.prepare(`
    SELECT p.*, b.name as bank_name
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    WHERE p.reference_type = 'rent_bill' AND p.reference_id = ?
    ORDER BY p.payment_date ASC, p.id ASC
  `).all(id);

  const totalAmount = parseFloat(bill.amount) || 0;
  const totalPaid = bill.paid_amount != null
    ? (parseFloat(bill.paid_amount) || 0)
    : payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
  const balance = totalAmount - totalPaid;

  const company = getCompanySettings(db);
  const safeTitle = (bill.title || `rent-bill-${id}`).replace(/\s+/g, '-');
  const filenameBase = `rent-bill-ledger-${safeTitle}`;

  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || 'Finance Software';

    const ws = wb.addWorksheet('Ledger');
    addExcelCompanyHeader(ws, company, `Rent/Bill Ledger — ${bill.title}`, wb);
    ws.addRow(['Title', 'Category', 'Amount', 'Paid', 'Balance', 'Due Date', 'Status']);
    ws.lastRow.font = { bold: true };
    ws.addRow([
      bill.title,
      bill.category || 'bill',
      totalAmount,
      totalPaid,
      balance,
      bill.due_date || '',
      bill.status || 'pending',
    ]);

    const wsPay = wb.addWorksheet('Payments');
    addExcelCompanyHeader(wsPay, company, `Payments — ${bill.title}`, wb);
    wsPay.addRow(['Payment Date', 'Mode', 'Bank', 'Amount', 'Remarks']);
    wsPay.lastRow.font = { bold: true };
    payments.forEach((p) => {
      wsPay.addRow([
        p.payment_date,
        p.mode === 'bank' ? 'Bank' : 'Cash',
        p.bank_name || '',
        parseFloat(p.amount) || 0,
        p.remarks || '',
      ]);
    });

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

    addPdfCompanyHeader(doc, company, { title: 'Rent/Bill Ledger', subtitle: bill.title });
    doc.fontSize(10).font('Helvetica').text(
      `Amount: ${totalAmount.toFixed(2)}   Paid: ${totalPaid.toFixed(2)}   Balance: ${balance.toFixed(2)}`
    );
    if (bill.due_date || bill.status || bill.category) {
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica').text(
        `Category: ${bill.category || 'bill'}   Due: ${bill.due_date || '–'}   Status: ${bill.status || 'pending'}`
      );
    }
    if (bill.remarks) {
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica').text(`Remarks: ${bill.remarks}`);
    }

    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text('Payments', { underline: true });
    doc.moveDown(0.25);

    if (payments.length) {
      doc.fontSize(9).font('Helvetica').text('Date\tMode\tBank\tAmount\tRemarks', { lineGap: 2 });
      payments.forEach((p) => {
        doc.text(
          `${p.payment_date || ''}\t${p.mode === 'bank' ? 'Bank' : 'Cash'}\t${p.bank_name || '–'}\t${(parseFloat(p.amount) || 0).toFixed(2)}\t${p.remarks || '–'}`,
          { lineGap: 2 }
        );
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
