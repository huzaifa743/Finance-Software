import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

// Options for payment form: suppliers, rent_bills (unpaid), salary records (pending)
router.get('/options', authenticate, (req, res) => {
  const suppliers = db.prepare('SELECT id, name FROM suppliers ORDER BY name').all();
  const rentBills = db.prepare(`
    SELECT id, title, category, amount, paid_amount, (amount - COALESCE(paid_amount, 0)) as balance, status, due_date
    FROM rent_bills
    WHERE status IN ('pending', 'partial')
    ORDER BY due_date ASC, id DESC
  `).all();
  const salaries = db.prepare(`
    SELECT sr.id, sr.staff_id, sr.month_year, sr.net_salary, s.name as staff_name, b.name as branch_name
    FROM salary_records sr
    JOIN staff s ON sr.staff_id = s.id
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE sr.status = 'processed'
    ORDER BY sr.month_year DESC, s.name
  `).all();
  const banks = db.prepare('SELECT id, name, account_number FROM banks ORDER BY name').all();
  res.json({ suppliers, rent_bills: rentBills, salaries, banks });
});

// List recent payments (all types)
router.get('/', authenticate, (req, res) => {
  const { type, from, to, limit } = req.query;
  let sql = `
    SELECT p.*, b.name as bank_name
    FROM payments p
    LEFT JOIN banks b ON p.bank_id = b.id
    WHERE 1=1
  `;
  const params = [];
  if (type) { sql += ' AND p.reference_type = ?'; params.push(type); }
  if (from) { sql += ' AND p.payment_date >= ?'; params.push(from); }
  if (to) { sql += ' AND p.payment_date <= ?'; params.push(to); }
  sql += ' ORDER BY p.payment_date DESC, p.id DESC';
  const lim = Math.min(parseInt(limit) || 100, 500);
  sql += ` LIMIT ${lim}`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.post('/', authenticate, requireNotAuditor, logActivity('payment', 'payments', req => req.body?.category || ''), (req, res) => {
  try {
    const { category, reference_id, amount, payment_date, payment_method, remarks } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const validCategories = ['supplier', 'rent_bill', 'salary'];
    if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category. Use supplier, rent_bill, or salary.' });
    if (!reference_id) return res.status(400).json({ error: 'reference_id required.' });

    const isBank = payment_method !== 'cash' && payment_method !== '' && payment_method != null;
    const bankId = isBank ? parseInt(payment_method, 10) : null;
    const mode = isBank ? 'bank' : 'cash';
    const paymentDate = payment_date || new Date().toISOString().slice(0, 10);

    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(remarks, voucher);

    if (category === 'supplier') {
      const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(reference_id);
      if (!sup) return res.status(404).json({ error: 'Supplier not found.' });
    } else if (category === 'rent_bill') {
      const rb = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(reference_id);
      if (!rb) return res.status(404).json({ error: 'Rent/Bill not found.' });
      const balance = (parseFloat(rb.amount) || 0) - (parseFloat(rb.paid_amount) || 0);
      if (amt > balance) return res.status(400).json({ error: `Amount exceeds balance (${balance}).` });
    } else if (category === 'salary') {
      const sr = db.prepare('SELECT * FROM salary_records WHERE id = ?').get(reference_id);
      if (!sr) return res.status(404).json({ error: 'Salary record not found.' });
      if (sr.status === 'paid') return res.status(400).json({ error: 'Salary already paid.' });
    }

    if (isBank && bankId) {
      const bank = db.prepare('SELECT id FROM banks WHERE id = ?').get(bankId);
      if (!bank) return res.status(400).json({ error: 'Bank not found.' });
      db.prepare(`
        INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
        VALUES (?, 'payment', ?, ?, ?, ?)
      `).run(bankId, amt, paymentDate, voucherRemarks || voucher, `Payment ${category} #${reference_id}`);
    }

    db.prepare(`
      INSERT INTO payments (type, reference_id, reference_type, amount, payment_date, mode, bank_id, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(category, reference_id, category, amt, paymentDate, mode, bankId, voucherRemarks || null);

    if (category === 'rent_bill') {
      const rb = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(reference_id);
      const newPaid = (parseFloat(rb.paid_amount) || 0) + amt;
      const total = parseFloat(rb.amount) || 0;
      const newStatus = newPaid >= total ? 'paid' : 'partial';
      db.prepare('UPDATE rent_bills SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(newPaid, newStatus, new Date().toISOString(), reference_id);
    } else if (category === 'salary') {
      db.prepare("UPDATE salary_records SET status = 'paid' WHERE id = ?").run(reference_id);
    }

    res.status(201).json({ ok: true, amount: amt, category });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
