import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

// Options for payment form: suppliers, rent_bills (unpaid), salary records (pending), customers with balance (receive)
router.get('/options', authenticate, (req, res) => {
  const suppliers = db.prepare('SELECT id, name FROM suppliers ORDER BY name').all();
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
      b.name as branch_name
    FROM salary_records sr
    JOIN staff s ON sr.staff_id = s.id
    LEFT JOIN branches b ON s.branch_id = b.id
    WHERE sr.status = 'processed'
    ORDER BY sr.month_year DESC, s.name
  `).all();
  const customersWithBalance = db.prepare(`
    SELECT c.id, c.name,
      COALESCE(SUM(CASE WHEN r.status IN ('pending','partial') THEN r.amount ELSE 0 END), 0) as total_due
    FROM customers c
    LEFT JOIN receivables r ON r.customer_id = c.id
    GROUP BY c.id, c.name
    HAVING total_due > 0
    ORDER BY c.name
  `).all();
  const banks = db.prepare('SELECT id, name, account_number FROM banks ORDER BY name').all();
  res.json({ suppliers, rent_bills: rentBills, salaries, customers_with_balance: customersWithBalance, banks });
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
    const validCategories = ['supplier', 'rent_bill', 'salary', 'receivable_recovery'];
    if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
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
    } else if (category === 'receivable_recovery') {
      const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(reference_id);
      if (!rec) return res.status(404).json({ error: 'Receivable not found.' });
      const due = parseFloat(rec.amount) || 0;
      if (amt > due) return res.status(400).json({ error: `Amount exceeds due (${due}).` });
    }

    if (category === 'receivable_recovery') {
      const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(reference_id);
      const remaining = parseFloat(rec.amount) - amt;
      const newStatus = remaining <= 0 ? 'recovered' : 'partial';
      db.prepare('INSERT INTO receivable_recoveries (receivable_id, amount, remarks) VALUES (?, ?, ?)').run(
        reference_id, amt, voucherRemarks || null
      );
      db.prepare('UPDATE receivables SET amount = ?, status = ? WHERE id = ?').run(Math.max(0, remaining), newStatus, reference_id);
    } else if (category === 'supplier') {
      // Allocate supplier payment across open purchases (FIFO by date)
      let remaining = amt;
      const purchases = db.prepare(`
        SELECT * FROM purchases
        WHERE supplier_id = ? AND balance > 0
        ORDER BY purchase_date ASC, id ASC
      `).all(reference_id);
      const updateStmt = db.prepare('UPDATE purchases SET paid_amount = ?, balance = ? WHERE id = ?');
      for (const p of purchases) {
        if (remaining <= 0) break;
        const currentBalance = parseFloat(p.balance) || 0;
        if (currentBalance <= 0) continue;
        const apply = Math.min(remaining, currentBalance);
        const newPaid = (parseFloat(p.paid_amount) || 0) + apply;
        const newBalance = Math.max(0, currentBalance - apply);
        updateStmt.run(newPaid, newBalance, p.id);
        remaining -= apply;
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
        category === 'receivable_recovery' ? 'deposit' : 'payment',
        amt,
        paymentDate,
        voucherRemarks || voucher,
        category === 'receivable_recovery' ? `Receivable recovery #${reference_id}` : `Payment ${category} #${reference_id}`
      );
    }

    db.prepare(`
      INSERT INTO payments (type, reference_id, reference_type, amount, payment_date, mode, bank_id, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(category, reference_id, category === 'receivable_recovery' ? 'receivable' : category, amt, paymentDate, mode, bankId, voucherRemarks || null);

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
