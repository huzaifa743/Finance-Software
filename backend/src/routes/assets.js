import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

router.get('/assets', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM assets ORDER BY name').all();
  res.json(rows);
});

router.post('/assets', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'assets', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, purchase_date, cost, depreciation_rate, current_value } = req.body;
    const c = parseFloat(cost) || 0;
    const cv = current_value !== undefined ? parseFloat(current_value) : c;
    const r = db.prepare(`
      INSERT INTO assets (name, purchase_date, cost, depreciation_rate, current_value)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, purchase_date || null, c, parseFloat(depreciation_rate) || 0, cv);
    res.status(201).json({ id: r.lastInsertRowid, name, cost: c, current_value: cv });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/assets/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'assets', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    ['name', 'purchase_date', 'cost', 'depreciation_rate', 'current_value'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/loans', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM loans ORDER BY start_date DESC').all();
  res.json(rows);
});

router.get('/loans/:id', authenticate, (req, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found.' });
  const installments = db.prepare('SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY due_date').all(loan.id);
  const paidTotal = installments.filter(i => i.status === 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
  const principal = parseFloat(loan.principal) || 0;
  res.json({ ...loan, installments, paidTotal, balance: principal - paidTotal });
});

router.post('/loans', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'loans', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, principal, interest_rate, tenure_months, emi_amount, start_date, status } = req.body;
    const p = parseFloat(principal) || 0;
    const emi = parseFloat(emi_amount) || 0;
    const r = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, tenure_months, emi_amount, start_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      p,
      parseFloat(interest_rate) || 0,
      tenure_months || null,
      emi,
      start_date || null,
      status || 'active'
    );
    const loanId = r.lastInsertRowid;
    const tenure = parseInt(tenure_months) || 0;
    const start = start_date ? new Date(start_date) : new Date();
    if (tenure > 0 && emi > 0) {
      const stmt = db.prepare('INSERT INTO loan_installments (loan_id, amount, due_date, status) VALUES (?, ?, ?, ?)');
      for (let i = 1; i <= tenure; i++) {
        const d = new Date(start);
        d.setMonth(d.getMonth() + i);
        stmt.run(loanId, emi, d.toISOString().slice(0, 10), 'pending');
      }
    }
    res.status(201).json({ id: loanId, name, principal: p, emi_amount: emi });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/loans/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'loans', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    ['name', 'principal', 'interest_rate', 'tenure_months', 'emi_amount', 'start_date', 'status'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE loans SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/loans/:id/installments/:instId/pay', authenticate, requireNotAuditor, logActivity('pay_installment', 'loans', req => req.params.id), (req, res) => {
  try {
    const { id, instId } = req.params;
    const inst = db.prepare('SELECT * FROM loan_installments WHERE id = ? AND loan_id = ?').get(instId, id);
    if (!inst) return res.status(404).json({ error: 'Installment not found.' });
    if (inst.status === 'paid') return res.status(400).json({ error: 'Already paid.' });
    db.prepare('UPDATE loan_installments SET status = ?, paid_date = date(\'now\') WHERE id = ?').run('paid', instId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/loans/balance-report', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM loans WHERE status = ?').all('active');
  const result = rows.map(l => {
    const inst = db.prepare('SELECT * FROM loan_installments WHERE loan_id = ?').all(l.id);
    const paid = inst.filter(i => i.status === 'paid').reduce((a, i) => a + (parseFloat(i.amount) || 0), 0);
    const principal = parseFloat(l.principal) || 0;
    return { ...l, paidTotal: paid, balance: principal - paid };
  });
  res.json(result);
});

export default router;
