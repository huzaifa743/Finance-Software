import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';
import { getCompanySettings, addPdfCompanyHeader, addExcelCompanyHeader } from '../utils/companyBranding.js';

const router = Router();

router.get('/customers', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM customers ORDER BY name').all();
  res.json(rows);
});

router.get('/customers/with-balance', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.contact, c.address,
      COALESCE(SUM(CASE WHEN r.status IN ('pending','partial') THEN r.amount ELSE 0 END), 0) as total_due
    FROM customers c
    LEFT JOIN receivables r ON r.customer_id = c.id
    GROUP BY c.id, c.name, c.contact, c.address
    ORDER BY c.name
  `).all();
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
    SELECT r.*, b.name as branch_name
    FROM receivables r
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
    WHERE r.customer_id = ? ORDER BY r.created_at ASC
  `).all(customerId);
  const recoveries = db.prepare(`
    SELECT rr.*, r.amount as original_amount FROM receivable_recoveries rr
    JOIN receivables r ON rr.receivable_id = r.id
    WHERE r.customer_id = ? ORDER BY rr.recovered_at ASC
  `).all(customerId);
  const recoveredByReceivable = new Map();
  recoveries.forEach((rr) => {
    const key = rr.receivable_id;
    const amt = parseFloat(rr.amount) || 0;
    if (!key || !amt) return;
    recoveredByReceivable.set(key, (recoveredByReceivable.get(key) || 0) + amt);
  });
  const totalDue = receivables
    .filter(r => r.status === 'pending' || r.status === 'partial')
    .reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const recoveredTotal = recoveries.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);

  // Build unified ledger entries: Credit (receivables), Debit (recoveries), running Balance
  const entries = [];
  receivables.forEach((r) => {
    const remaining = parseFloat(r.amount) || 0;
    const alreadyRecovered = recoveredByReceivable.get(r.id) || 0;
    const original = remaining + alreadyRecovered;
    entries.push({
      date: (r.created_at || '').slice(0, 10),
      sortKey: r.created_at || '',
      description: `Receivable${r.id ? ` #${r.id}` : ''}${r.branch_name ? ` (${r.branch_name})` : ''}`,
      credit: original,
      debit: 0,
      id: `rec-${r.id}`,
      type: 'receivable',
    });
  });
  recoveries.forEach((rr) => {
    const amt = parseFloat(rr.amount) || 0;
    entries.push({
      date: (rr.recovered_at || '').slice(0, 10),
      sortKey: rr.recovered_at || '',
      description: rr.remarks ? `Recovery — ${rr.remarks}` : 'Recovery',
      credit: 0,
      debit: amt,
      id: `recovery-${rr.id}`,
      type: 'recovery',
    });
  });
  entries.sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || '') || 0);
  let runningBalance = 0;
  entries.forEach((e) => {
    runningBalance += (e.credit || 0) - (e.debit || 0);
    e.balance = runningBalance;
  });

  res.json({ customer, receivables, recoveries, entries, totalDue, recoveredTotal });
});

// Branch-wise receivables ledger (credit / debit / balance) similar to customer ledger
router.get('/branch-ledger/:branchId', authenticate, (req, res) => {
  const { branchId } = req.params;

  const receivables = db.prepare(`
    SELECT r.*, b.name as branch_name
    FROM receivables r
    LEFT JOIN branches b ON r.branch_id = b.id
    WHERE r.branch_id = ?
    ORDER BY r.created_at ASC
  `).all(branchId);

  const recoveries = db.prepare(`
    SELECT rr.*, r.amount as original_amount
    FROM receivable_recoveries rr
    JOIN receivables r ON rr.receivable_id = r.id
    WHERE r.branch_id = ?
    ORDER BY rr.recovered_at ASC
  `).all(branchId);

  const recoveredByReceivable = new Map();
  recoveries.forEach((rr) => {
    const key = rr.receivable_id;
    const amt = parseFloat(rr.amount) || 0;
    if (!key || !amt) return;
    recoveredByReceivable.set(key, (recoveredByReceivable.get(key) || 0) + amt);
  });

  const totalDue = receivables
    .filter(r => r.status === 'pending' || r.status === 'partial')
    .reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  const recoveredTotal = recoveries.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);

  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);

  // Build unified ledger entries: Credit (receivables), Debit (recoveries), running Balance
  const entries = [];
  receivables.forEach((r) => {
    const remaining = parseFloat(r.amount) || 0;
    const alreadyRecovered = recoveredByReceivable.get(r.id) || 0;
    const original = remaining + alreadyRecovered;
    entries.push({
      date: (r.created_at || '').slice(0, 10),
      sortKey: r.created_at || '',
      description: `Credit sale${r.id ? ` #${r.id}` : ''}${r.branch_name ? ` (${r.branch_name})` : ''}`,
      credit: original,
      debit: 0,
      id: `branch-rec-${r.id}`,
      type: 'receivable',
    });
  });
  recoveries.forEach((rr) => {
    const amt = parseFloat(rr.amount) || 0;
    entries.push({
      date: (rr.recovered_at || '').slice(0, 10),
      sortKey: rr.recovered_at || '',
      description: rr.remarks ? `Recovery — ${rr.remarks}` : 'Recovery',
      credit: 0,
      debit: amt,
      id: `branch-recovery-${rr.id}`,
      type: 'recovery',
    });
  });

  entries.sort((a, b) => (a.sortKey || '').localeCompare(b.sortKey || '') || 0);
  let runningBalance = 0;
  entries.forEach((e) => {
    runningBalance += (e.credit || 0) - (e.debit || 0);
    e.balance = runningBalance;
  });

  res.json({ branch, receivables, recoveries, entries, totalDue, recoveredTotal });
});

router.get('/ledger/:customerId/pdf', authenticate, (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const receivables = db.prepare(`
      SELECT r.*, b.name as branch_name FROM receivables r
      LEFT JOIN branches b ON r.branch_id = b.id
      WHERE r.customer_id = ? ORDER BY r.created_at ASC
    `).all(customerId);
    const recoveries = db.prepare(`
      SELECT rr.*, r.id as receivable_id FROM receivable_recoveries rr
      JOIN receivables r ON rr.receivable_id = r.id
      WHERE r.customer_id = ? ORDER BY rr.recovered_at ASC
    `).all(customerId);
    const totalDue = receivables
      .filter(r => r.status === 'pending' || r.status === 'partial')
      .reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);

    const company = getCompanySettings(db);
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receivable-ledger-${(customer.name || 'customer').replace(/\s+/g, '-')}.pdf"`);
    doc.pipe(res);

    addPdfCompanyHeader(doc, company, { title: 'Receivables Ledger', subtitle: `Customer: ${customer.name}` });
    if (customer.contact) doc.fontSize(9).font('Helvetica').text(`Contact: ${customer.contact}`);
    if (customer.address) doc.fontSize(9).font('Helvetica').text(`Address: ${customer.address}`);
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').text(`Total Due: ${Number(totalDue).toFixed(2)}`, { underline: true });
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('Credit entries (Receivables)', { underline: true });
    doc.moveDown(0.25);
    if (receivables.length) {
      doc.fontSize(9).text('Date\tBranch\tAmount\tStatus\tDue Date', { lineGap: 2 });
      receivables.forEach((r) => {
        doc.text(`${(r.created_at || '').slice(0, 10)}\t${r.branch_name || '–'}\t${parseFloat(r.amount || 0).toFixed(2)}\t${r.status || '–'}\t${r.due_date || '–'}`, { lineGap: 2 });
      });
    } else {
      doc.text('No entries.');
    }
    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('Recoveries', { underline: true });
    doc.moveDown(0.25);
    if (recoveries.length) {
      doc.fontSize(9).text('Date\tAmount\tRemarks', { lineGap: 2 });
      recoveries.forEach((rr) => {
        doc.text(`${(rr.recovered_at || '').slice(0, 10)}\t${parseFloat(rr.amount || 0).toFixed(2)}\t${rr.remarks || '–'}`, { lineGap: 2 });
      });
    } else {
      doc.text('No recoveries yet.');
    }

    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/ledger/:customerId/export', authenticate, async (req, res) => {
  const { customerId } = req.params;
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: 'type is required (pdf or xlsx)' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const receivables = db.prepare(`
    SELECT r.*, b.name as branch_name FROM receivables r
    LEFT JOIN branches b ON r.branch_id = b.id
    WHERE r.customer_id = ? ORDER BY r.created_at ASC
  `).all(customerId);
  const recoveries = db.prepare(`
    SELECT rr.*, r.id as receivable_id FROM receivable_recoveries rr
    JOIN receivables r ON rr.receivable_id = r.id
    WHERE r.customer_id = ? ORDER BY rr.recovered_at ASC
  `).all(customerId);
  const totalDue = receivables
    .filter(r => r.status === 'pending' || r.status === 'partial')
    .reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);

  const company = getCompanySettings(db);

  if (type === 'pdf') {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receivable-ledger-${(customer.name || 'customer').replace(/\s+/g, '-')}.pdf"`);
    doc.pipe(res);
    addPdfCompanyHeader(doc, company, { title: 'Receivables Ledger', subtitle: `Customer: ${customer.name}` });
    if (customer.contact) doc.fontSize(9).font('Helvetica').text(`Contact: ${customer.contact}`);
    if (customer.address) doc.fontSize(9).font('Helvetica').text(`Address: ${customer.address}`);
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').text(`Total Due: ${Number(totalDue).toFixed(2)}`, { underline: true });
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text('Credit entries (Receivables)', { underline: true });
    doc.moveDown(0.25);
    if (receivables.length) {
      doc.fontSize(9).font('Helvetica').text('Date\tBranch\tAmount\tStatus\tDue Date', { lineGap: 2 });
      receivables.forEach((r) => {
        doc.text(`${(r.created_at || '').slice(0, 10)}\t${r.branch_name || '–'}\t${parseFloat(r.amount || 0).toFixed(2)}\t${r.status || '–'}\t${r.due_date || '–'}`, { lineGap: 2 });
      });
    } else doc.text('No entries.');
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica-Bold').text('Recoveries', { underline: true });
    doc.moveDown(0.25);
    if (recoveries.length) {
      doc.fontSize(9).text('Date\tAmount\tRemarks', { lineGap: 2 });
      recoveries.forEach((rr) => {
        doc.text(`${(rr.recovered_at || '').slice(0, 10)}\t${parseFloat(rr.amount || 0).toFixed(2)}\t${rr.remarks || '–'}`, { lineGap: 2 });
      });
    } else doc.text('No recoveries yet.');
    doc.end();
    return;
  }

  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || 'Finance Software';
    const wsRec = wb.addWorksheet('Receivables', { views: [{ state: 'frozen', ySplit: 1 }] });
    addExcelCompanyHeader(wsRec, company, `Receivables Ledger — ${customer.name}`, wb);
    wsRec.addRow(['Date', 'Branch', 'Amount', 'Status', 'Due Date']);
    wsRec.lastRow.font = { bold: true };
    receivables.forEach((r) => wsRec.addRow([(r.created_at || '').slice(0, 10), r.branch_name || '–', parseFloat(r.amount) || 0, r.status || '–', r.due_date || '–']));
    const wsRecov = wb.addWorksheet('Recoveries');
    addExcelCompanyHeader(wsRecov, company, `Recoveries — ${customer.name}`, wb);
    wsRecov.addRow(['Date', 'Amount', 'Remarks']);
    wsRecov.lastRow.font = { bold: true };
    recoveries.forEach((r) => wsRecov.addRow([(r.recovered_at || '').slice(0, 10), parseFloat(r.amount) || 0, r.remarks || '–']));
    const summary = wb.addWorksheet('Summary');
    addExcelCompanyHeader(summary, company, `Receivables Ledger — ${customer.name}`, wb);
    summary.addRow(['Customer', customer.name]);
    summary.addRow(['Total due', totalDue]);
    summary.addRow(['Total recovered', recoveries.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="receivable-ledger-${(customer.name || 'customer').replace(/\s+/g, '-')}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  return res.status(400).json({ error: 'Unsupported type. Use pdf or xlsx.' });
});

router.get('/overdue', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, b.name as branch_name
    FROM receivables r
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

router.get('/branch-ledger', authenticate, (req, res) => {
  const { from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (from) { where += ' AND r.created_at >= ?'; params.push(from); }
  if (to) { where += ' AND r.created_at <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT
      b.id as branch_id,
      b.name as branch_name,
      COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN r.amount + COALESCE(rr_sum.total_recovered, 0) ELSE 0 END), 0) as credit_sales,
      COALESCE(SUM(CASE WHEN r.status IN ('pending','partial') THEN r.amount ELSE 0 END), 0) as receivable_amount,
      COALESCE(SUM(COALESCE(rr_sum.total_recovered, 0)), 0) as received_amount
    FROM branches b
    LEFT JOIN receivables r ON r.branch_id = b.id
    LEFT JOIN (
      SELECT receivable_id, SUM(amount) as total_recovered
      FROM receivable_recoveries
      GROUP BY receivable_id
    ) rr_sum ON rr_sum.receivable_id = r.id
    WHERE b.is_active = 1 AND ${where}
    GROUP BY b.id, b.name
    ORDER BY b.name
  `).all(...params);

  const withBalance = rows.map((r) => {
    const pending = parseFloat(r.receivable_amount) || 0;
    return { ...r, pending_balance: pending };
  });

  res.json(withBalance);
});

router.get('/branch-ledger/export', authenticate, async (req, res) => {
  const { from, to, type } = req.query;
  if (!type) return res.status(400).json({ error: 'type is required (pdf or xlsx)' });

  let where = '1=1';
  const params = [];
  if (from) { where += ' AND r.created_at >= ?'; params.push(from); }
  if (to) { where += ' AND r.created_at <= ?'; params.push(to); }

  const rows = db.prepare(`
    SELECT
      b.id as branch_id,
      b.name as branch_name,
      COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN r.amount + COALESCE(rr_sum.total_recovered, 0) ELSE 0 END), 0) as credit_sales,
      COALESCE(SUM(CASE WHEN r.status IN ('pending','partial') THEN r.amount ELSE 0 END), 0) as receivable_amount,
      COALESCE(SUM(COALESCE(rr_sum.total_recovered, 0)), 0) as received_amount
    FROM branches b
    LEFT JOIN receivables r ON r.branch_id = b.id
    LEFT JOIN (
      SELECT receivable_id, SUM(amount) as total_recovered
      FROM receivable_recoveries
      GROUP BY receivable_id
    ) rr_sum ON rr_sum.receivable_id = r.id
    WHERE b.is_active = 1 AND ${where}
    GROUP BY b.id, b.name
    ORDER BY b.name
  `).all(...params);

  const data = rows.map((r) => {
    const pending = parseFloat(r.receivable_amount) || 0;
    return { ...r, pending_balance: pending };
  });

  const filename = `branch_ledger_${from || 'all'}_${to || 'all'}`;

  if (type === 'xlsx') {
    const company = getCompanySettings(db);
    const wb = new ExcelJS.Workbook();
    wb.creator = company.companyName || 'Finance Software';
    const ws = wb.addWorksheet('Branch Ledger');
    addExcelCompanyHeader(ws, company, `Branch-wise Receivables${from || to ? ` (${from || '-'} to ${to || '-'})` : ''}`, wb);
    ws.addRow(['Branch', 'Credit sales', 'Receivables', 'Received', 'Pending balance']);
    ws.lastRow.font = { bold: true };
    data.forEach((r) => ws.addRow([r.branch_name, r.credit_sales, r.receivable_amount, r.received_amount, r.pending_balance]));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  if (type === 'pdf') {
    const company = getCompanySettings(db);
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    doc.pipe(res);

    addPdfCompanyHeader(doc, company, { title: 'Branch-wise Receivables Ledger', subtitle: from || to ? `From: ${from || '-'}   To: ${to || '-'}` : '' });

    data.forEach((r) => {
      doc.fontSize(10).font('Helvetica').text(
        `${r.branch_name} | Credit sales: ${r.credit_sales} | Receivables: ${r.receivable_amount} | Received: ${r.received_amount} | Pending: ${r.pending_balance}`
      );
    });

    doc.end();
    return;
  }

  return res.status(400).json({ error: 'Unsupported export type. Use pdf or xlsx.' });
});

export default router;
