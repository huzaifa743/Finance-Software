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
const salesUploadDir = path.join(__dirname, '../../data/uploads/sales');
if (!fs.existsSync(salesUploadDir)) fs.mkdirSync(salesUploadDir, { recursive: true });

const sanitizeName = (name) => (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, salesUploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeName(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function netSales(row) {
  const cash = parseFloat(row.cash_amount) || 0;
  const bank = parseFloat(row.bank_amount) || 0;
  const credit = parseFloat(row.credit_amount) || 0;
  const discount = parseFloat(row.discount) || 0;
  const returns = parseFloat(row.returns_amount) || 0;
  return Math.max(0, cash + bank + credit - discount - returns);
}

router.get('/', authenticate, (req, res) => {
  const { branch_id, from, to, type } = req.query;
  let sql = `
    SELECT
      s.*,
      b.name as branch_name,
      c.name as customer_name,
      (
        SELECT GROUP_CONCAT(bk.name || ':' || printf('%.0f', sbs.amount), ', ')
        FROM sale_bank_splits sbs
        JOIN banks bk ON bk.id = sbs.bank_id
        WHERE sbs.sale_id = s.id
      ) as bank_split_label
    FROM sales s
    LEFT JOIN branches b ON s.branch_id = b.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  if (from) { sql += ' AND s.sale_date >= ?'; params.push(from); }
  if (to) { sql += ' AND s.sale_date <= ?'; params.push(to); }
  if (type) { sql += ' AND s.type = ?'; params.push(type); }
  sql += ' ORDER BY s.sale_date DESC, s.id DESC';
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  sql += ` LIMIT ${limit}`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/reports/daily', authenticate, (req, res) => {
  const { date, branch_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  let sql = `
    SELECT s.*, b.name as branch_name FROM sales s
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE s.sale_date = ?
  `;
  const params = [date];
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  sql += ' ORDER BY s.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.net_sales) || 0), 0);
  res.json({ date, branch_id: branch_id || null, rows, total });
});

router.get('/reports/monthly', authenticate, (req, res) => {
  const { month, year, branch_id } = req.query;
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  let sql = `
    SELECT s.sale_date, SUM(s.net_sales) as daily_total, s.branch_id, b.name as branch_name
    FROM sales s LEFT JOIN branches b ON s.branch_id = b.id
    WHERE s.sale_date >= ? AND s.sale_date <= ?
  `;
  const params = [from, to];
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  sql += ' GROUP BY s.sale_date, s.branch_id ORDER BY s.sale_date, s.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
  res.json({ month, year, from, to, rows, total });
});

router.get('/reports/date-range', authenticate, (req, res) => {
  const { from, to, branch_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  let sql = `
    SELECT s.*, b.name as branch_name FROM sales s
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE s.sale_date >= ? AND s.sale_date <= ?
  `;
  const params = [from, to];
  if (branch_id) { sql += ' AND s.branch_id = ?'; params.push(branch_id); }
  sql += ' ORDER BY s.sale_date DESC, s.branch_id';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((a, r) => a + (parseFloat(r.net_sales) || 0), 0);
  res.json({ from, to, branch_id: branch_id || null, rows, total });
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT s.*, b.name as branch_name, c.name as customer_name FROM sales s
    LEFT JOIN branches b ON s.branch_id = b.id
    LEFT JOIN customers c ON s.customer_id = c.id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Sale not found.' });
  const att = db.prepare('SELECT * FROM sale_attachments WHERE sale_id = ?').all(row.id);
  const attachments = att.map((a) => ({
    ...a,
    url: a.path ? `/uploads/${a.path}` : null,
  }));
  const bankSplits = db.prepare(`
    SELECT id, bank_id, amount
    FROM sale_bank_splits
    WHERE sale_id = ?
    ORDER BY id
  `).all(row.id);
  res.json({ ...row, attachments, bank_splits: bankSplits });
});

router.get('/:id/attachments', authenticate, (req, res) => {
  const sale = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found.' });
  const rows = db.prepare('SELECT * FROM sale_attachments WHERE sale_id = ? ORDER BY id DESC').all(req.params.id);
  res.json(rows.map((a) => ({ ...a, url: a.path ? `/uploads/${a.path}` : null })));
});

router.post('/:id/attachments', authenticate, requireNotAuditor, upload.array('files', 10), logActivity('attach', 'sales', req => req.params.id), (req, res) => {
  try {
    const sale = db.prepare('SELECT id FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded.' });
    const stmt = db.prepare('INSERT INTO sale_attachments (sale_id, filename, path) VALUES (?, ?, ?)');
    const inserted = [];
    for (const f of files) {
      const relPath = `sales/${f.filename}`;
      const r = stmt.run(sale.id, f.originalname, relPath);
      inserted.push({ id: r.lastInsertRowid, filename: f.originalname, path: relPath, url: `/uploads/${relPath}` });
    }
    res.status(201).json({ ok: true, attachments: inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/attachments/:attId', authenticate, requireNotAuditor, logActivity('delete_attachment', 'sales', req => req.params.attId), (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM sale_attachments WHERE id = ? AND sale_id = ?').get(req.params.attId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Attachment not found.' });
    if (row.path) {
      const filePath = path.join(__dirname, '../../data/uploads', row.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM sale_attachments WHERE id = ?').run(req.params.attId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/lock', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('lock', 'sales', req => `${req.params.id}:${req.body?.lock ? 'lock' : 'unlock'}`), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sale not found.' });
    const lock = req.body?.lock === true || req.body?.lock === '1';
    db.prepare('UPDATE sales SET is_locked = ?, updated_at = ? WHERE id = ?').run(lock ? 1 : 0, new Date().toISOString(), req.params.id);
    res.json({ ok: true, is_locked: !!lock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', authenticate, requireNotAuditor, logActivity('create', 'sales', req => req.body?.sale_date || ''), (req, res) => {
  try {
    const { branch_id, customer_id, bank_id, sale_date, type, cash_amount, bank_amount, credit_amount, discount, returns_amount, remarks, due_date, bank_splits } = req.body;
    const cash = parseFloat(cash_amount) || 0;
    let bank = parseFloat(bank_amount) || 0;
    const credit = parseFloat(credit_amount) || 0;
    const disc = parseFloat(discount) || 0;
    const ret = parseFloat(returns_amount) || 0;

    const splitsArray = Array.isArray(bank_splits) ? bank_splits : [];
    const validSplits = splitsArray
      .map((s) => ({
        bank_id: s.bank_id ? parseInt(s.bank_id, 10) : null,
        amount: parseFloat(s.amount) || 0,
      }))
      .filter((s) => s.bank_id && s.amount > 0);

    const totalSplitBank = validSplits.reduce((sum, s) => sum + s.amount, 0);
    if (validSplits.length > 0) {
      bank = totalSplitBank;
    }

    const net = Math.max(0, cash + bank + credit - disc - ret);

    if (validSplits.length > 0) {
      for (const s of validSplits) {
        const bankRow = db.prepare('SELECT id FROM banks WHERE id = ?').get(s.bank_id);
        if (!bankRow) return res.status(400).json({ error: 'Selected bank account not found.' });
      }
    } else {
      const bankIdSingle = bank_id ? parseInt(bank_id, 10) : null;
      if (bank > 0 && !bankIdSingle) {
        return res.status(400).json({ error: 'Bank account is required when entering bank amount.' });
      }
      if (bank > 0 && bankIdSingle) {
        const bankRow = db.prepare('SELECT id FROM banks WHERE id = ?').get(bankIdSingle);
        if (!bankRow) return res.status(400).json({ error: 'Selected bank account not found.' });
      }
    }

    const primaryBankId =
      validSplits.length > 0
        ? validSplits[0].bank_id
        : bank_id
        ? parseInt(bank_id, 10)
        : null;

    const r = db.prepare(`
      INSERT INTO sales (branch_id, customer_id, bank_id, sale_date, type, cash_amount, bank_amount, credit_amount, discount, returns_amount, net_sales, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branch_id || null,
      customer_id || null,
      primaryBankId || null,
      sale_date,
      type || 'cash',
      cash,
      bank,
      credit,
      disc,
      ret,
      net,
      remarks || null,
      req.user?.id || null
    );
    const saleId = r.lastInsertRowid;

    // Auto-create receivable when credit amount > 0 (credit sale → receivables, branch-wise; customer optional)
    if (credit > 0 && saleId) {
      db.prepare(`
        INSERT INTO receivables (customer_id, sale_id, branch_id, amount, due_date, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(customer_id || null, saleId, branch_id || null, credit, due_date || null);
    }

    // Record bank deposits and splits for bank portion of sale
    if (bank > 0 && saleId) {
      if (validSplits.length > 0) {
        const insertSplit = db.prepare(`
          INSERT INTO sale_bank_splits (sale_id, bank_id, amount)
          VALUES (?, ?, ?)
        `);
        const insertTxn = db.prepare(`
          INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `);
        const txnDate = sale_date || new Date().toISOString().slice(0, 10);
        for (const s of validSplits) {
          insertSplit.run(saleId, s.bank_id, s.amount);
          insertTxn.run(s.bank_id, s.amount, txnDate, `sale-${saleId}`, 'Sale collection');
        }
      } else if (primaryBankId) {
        db.prepare(`
          INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `).run(primaryBankId, bank, sale_date || new Date().toISOString().slice(0, 10), `sale-${saleId}`, 'Sale collection');
      }
    }

    res.status(201).json({ id: saleId, net_sales: net });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireNotAuditor, logActivity('update', 'sales', req => req.params.id), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sale not found.' });
    if (existing.is_locked) return res.status(400).json({ error: 'Sale is locked.' });
    const { sale_date, type, customer_id, cash_amount, bank_amount, credit_amount, discount, returns_amount, remarks, bank_id, bank_splits } = req.body;
    const cash = cash_amount !== undefined ? parseFloat(cash_amount) || 0 : existing.cash_amount;
    let bank = bank_amount !== undefined ? parseFloat(bank_amount) || 0 : existing.bank_amount;
    const credit = credit_amount !== undefined ? parseFloat(credit_amount) || 0 : existing.credit_amount;
    const disc = discount !== undefined ? parseFloat(discount) || 0 : existing.discount;
    const ret = returns_amount !== undefined ? parseFloat(returns_amount) || 0 : existing.returns_amount;

    const splitsArray = Array.isArray(bank_splits) ? bank_splits : [];
    const validSplits = splitsArray
      .map((s) => ({
        bank_id: s.bank_id ? parseInt(s.bank_id, 10) : null,
        amount: parseFloat(s.amount) || 0,
      }))
      .filter((s) => s.bank_id && s.amount > 0);

    const totalSplitBank = validSplits.reduce((sum, s) => sum + s.amount, 0);
    if (validSplits.length > 0) {
      bank = totalSplitBank;
    }

    const net = Math.max(0, cash + bank + credit - disc - ret);

    if (validSplits.length > 0) {
      for (const s of validSplits) {
        const bankRow = db.prepare('SELECT id FROM banks WHERE id = ?').get(s.bank_id);
        if (!bankRow) return res.status(400).json({ error: 'Selected bank account not found.' });
      }
    } else {
      const bankIdSingle = bank_id !== undefined ? (bank_id ? parseInt(bank_id, 10) : null) : existing.bank_id;
      if (bank > 0 && !bankIdSingle) {
        return res.status(400).json({ error: 'Bank account is required when entering bank amount.' });
      }
      if (bank > 0 && bankIdSingle) {
        const bankRow = db.prepare('SELECT id FROM banks WHERE id = ?').get(bankIdSingle);
        if (!bankRow) return res.status(400).json({ error: 'Selected bank account not found.' });
      }
    }

    const primaryBankId =
      validSplits.length > 0
        ? validSplits[0].bank_id
        : bank_id !== undefined
        ? bank_id
          ? parseInt(bank_id, 10)
          : null
        : existing.bank_id;

    db.prepare(`
      UPDATE sales SET sale_date=?, type=?, customer_id=?, cash_amount=?, bank_amount=?, credit_amount=?, discount=?, returns_amount=?, net_sales=?, remarks=?, bank_id=?, updated_at=?
      WHERE id=?
    `).run(
      sale_date ?? existing.sale_date,
      type ?? existing.type,
      customer_id !== undefined ? customer_id : existing.customer_id,
      cash,
      bank,
      credit,
      disc,
      ret,
      net,
      remarks !== undefined ? remarks : existing.remarks,
      primaryBankId || null,
      new Date().toISOString(),
      req.params.id
    );

    // Replace bank splits and bank transactions for this sale
    db.prepare('DELETE FROM sale_bank_splits WHERE sale_id = ?').run(req.params.id);
    db.prepare("DELETE FROM bank_transactions WHERE reference = ? AND type = 'deposit'").run(`sale-${req.params.id}`);

    if (bank > 0) {
      const effectiveDate = sale_date ?? existing.sale_date ?? new Date().toISOString().slice(0, 10);
      if (validSplits.length > 0) {
        const insertSplit = db.prepare(`
          INSERT INTO sale_bank_splits (sale_id, bank_id, amount)
          VALUES (?, ?, ?)
        `);
        const insertTxn = db.prepare(`
          INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `);
        for (const s of validSplits) {
          insertSplit.run(req.params.id, s.bank_id, s.amount);
          insertTxn.run(s.bank_id, s.amount, effectiveDate, `sale-${req.params.id}`, 'Sale collection');
        }
      } else if (primaryBankId) {
        db.prepare(`
          INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
          VALUES (?, 'deposit', ?, ?, ?, ?)
        `).run(primaryBankId, bank, effectiveDate, `sale-${req.params.id}`, 'Sale collection');
      }
    }

    res.json({ ok: true, net_sales: net });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'sales', req => req.params.id), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sale not found.' });
    if (existing.is_locked) return res.status(400).json({ error: 'Sale is locked.' });

    // Remove any receivables and their recoveries that were created from this sale
    const relatedReceivables = db.prepare('SELECT id FROM receivables WHERE sale_id = ?').all(req.params.id);
    for (const r of relatedReceivables) {
      db.prepare('DELETE FROM receivable_recoveries WHERE receivable_id = ?').run(r.id);
      db.prepare('DELETE FROM receivables WHERE id = ?').run(r.id);
    }

    const att = db.prepare('SELECT * FROM sale_attachments WHERE sale_id = ?').all(req.params.id);
    for (const a of att) {
      if (a.path) {
        const filePath = path.join(__dirname, '../../data/uploads', a.path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.prepare('DELETE FROM sale_attachments WHERE sale_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
