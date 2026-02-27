import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

// Options for payment form: rent_bills (unpaid), salary records (with remaining), banks
router.get('/options', authenticate, (req, res) => {
  const rentBills = db.prepare(`
    SELECT id, title, category, amount, paid_amount, (amount - COALESCE(paid_amount, 0)) as balance, status, due_date
    FROM rent_bills
    WHERE status IN ('pending', 'partial')
    ORDER BY due_date ASC, id DESC
  `).all();
  const salaries = db.prepare(`
    SELECT
      sr.id,
      sr.staff_id,
      sr.month_year,
      sr.base_salary,
      sr.commission,
      sr.advances,
      sr.deductions,
      sr.net_salary,
      s.name as staff_name,
      b.name as branch_name,
      COALESCE(p.paid_amount, 0) AS paid_amount,
      (sr.net_salary - COALESCE(p.paid_amount, 0)) AS remaining_amount
    FROM salary_records sr
    JOIN staff s ON sr.staff_id = s.id
    LEFT JOIN branches b ON s.branch_id = b.id
    LEFT JOIN (
      SELECT reference_id AS salary_id, COALESCE(SUM(amount), 0) AS paid_amount
      FROM payments
      WHERE reference_type = 'salary'
      GROUP BY reference_id
    ) p ON p.salary_id = sr.id
    WHERE (sr.net_salary - COALESCE(p.paid_amount, 0)) > 0
    ORDER BY sr.month_year DESC, s.name
  `).all();
  const banks = db.prepare('SELECT id, name, account_number FROM banks ORDER BY name').all();
  res.json({ rent_bills: rentBills, salaries, banks });
});

// List recent payments (all types), with optional filters and enriched reference_label
router.get('/', authenticate, (req, res) => {
  const { type, from, to, limit } = req.query;
  let sql = `
    SELECT p.*, b.name as bank_name,
      CASE
        WHEN p.reference_type = 'supplier' THEN (SELECT name FROM suppliers WHERE id = p.reference_id)
        WHEN p.reference_type = 'rent_bill' THEN (SELECT title FROM rent_bills WHERE id = p.reference_id)
        WHEN p.reference_type = 'salary' THEN (
          SELECT s.name || ' — ' || sr.month_year FROM salary_records sr
          JOIN staff s ON sr.staff_id = s.id WHERE sr.id = p.reference_id
        )
        WHEN p.reference_type = 'receivable' THEN (
          SELECT c.name FROM receivables r
          JOIN customers c ON r.customer_id = c.id WHERE r.id = p.reference_id
        )
        ELSE NULL
      END as reference_label
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
    // Only allow payments for rent/bills and salaries from this screen
    const validCategories = ['rent_bill', 'salary'];
    if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
    if (!reference_id) return res.status(400).json({ error: 'reference_id required.' });

    const isBank = payment_method !== 'cash' && payment_method !== '' && payment_method != null;
    const bankId = isBank ? parseInt(payment_method, 10) : null;
    const mode = isBank ? 'bank' : 'cash';
    const paymentDate = payment_date || new Date().toISOString().slice(0, 10);

    const voucher = getNextVoucherNumber();
    const voucherRemarks = appendVoucherNote(remarks, voucher);

    if (category === 'rent_bill') {
      const rb = db.prepare('SELECT * FROM rent_bills WHERE id = ?').get(reference_id);
      if (!rb) return res.status(404).json({ error: 'Rent/Bill not found.' });
      const balance = (parseFloat(rb.amount) || 0) - (parseFloat(rb.paid_amount) || 0);
      if (amt > balance) return res.status(400).json({ error: `Amount exceeds balance (${balance}).` });
    } else if (category === 'salary') {
      const sr = db.prepare('SELECT * FROM salary_records WHERE id = ?').get(reference_id);
      if (!sr) return res.status(404).json({ error: 'Salary record not found.' });
      const paidRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as t
        FROM payments
        WHERE reference_type = 'salary' AND reference_id = ?
      `).get(reference_id);
      const alreadyPaid = parseFloat(paidRow?.t) || 0;
      const totalSalary = parseFloat(sr.net_salary) || 0;
      const remainingSalary = totalSalary - alreadyPaid;
      if (remainingSalary <= 0) {
        return res.status(400).json({ error: 'Salary already fully paid.' });
      }
      if (amt > remainingSalary) {
        return res.status(400).json({ error: `Amount exceeds remaining salary (${remainingSalary}).` });
      }
    }

    if (isBank && bankId) {
      const bank = db.prepare('SELECT id FROM banks WHERE id = ?').get(bankId);
      if (!bank) return res.status(400).json({ error: 'Bank not found.' });
      db.prepare(`
        INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        bankId,
        'payment',
        amt,
        paymentDate,
        voucherRemarks || voucher,
        `Payment ${category} #${reference_id}`
      );
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
      const sr = db.prepare('SELECT net_salary FROM salary_records WHERE id = ?').get(reference_id);
      const paidRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as t
        FROM payments
        WHERE reference_type = 'salary' AND reference_id = ?
      `).get(reference_id);
      const totalSalary = parseFloat(sr?.net_salary) || 0;
      const paidTotal = parseFloat(paidRow?.t) || 0;
      const remainingSalary = totalSalary - paidTotal;
      const newStatus = remainingSalary <= 0 ? 'paid' : 'partial';
      db.prepare('UPDATE salary_records SET status = ? WHERE id = ?').run(newStatus, reference_id);
    }

    res.status(201).json({ ok: true, amount: amt, category });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
