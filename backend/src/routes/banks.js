import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';
import { getNextVoucherNumber, appendVoucherNote } from '../utils/autoNumbering.js';

const router = Router();

function balance(bankId) {
  const opening = db.prepare('SELECT opening_balance FROM banks WHERE id = ?').get(bankId);
  const ob = parseFloat(opening?.opening_balance) || 0;
  const deposits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions
    WHERE bank_id = ? AND type IN ('deposit', 'transfer_in')
  `).get(bankId);
  const withdrawals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions
    WHERE bank_id = ? AND type IN ('withdrawal', 'payment', 'transfer_out')
  `).get(bankId);
  return ob + (parseFloat(deposits?.t) || 0) - (parseFloat(withdrawals?.t) || 0);
}

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM banks ORDER BY name').all();
  const withBalance = rows.map(r => ({ ...r, current_balance: balance(r.id) }));
  res.json(withBalance);
});

router.get('/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM banks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bank not found.' });
  res.json({ ...row, current_balance: balance(row.id) });
});

router.get('/:id/ledger', authenticate, (req, res) => {
  const bank = db.prepare('SELECT * FROM banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Bank not found.' });
  const { from, to } = req.query;
  let sql = 'SELECT * FROM bank_transactions WHERE bank_id = ?';
  const params = [req.params.id];
  if (from) { sql += ' AND transaction_date >= ?'; params.push(from); }
  if (to) { sql += ' AND transaction_date <= ?'; params.push(to); }
  sql += ' ORDER BY transaction_date DESC, id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ bank: { ...bank, current_balance: balance(bank.id) }, transactions: rows });
});

router.get('/:id/reconciliation', authenticate, (req, res) => {
  const bank = db.prepare('SELECT * FROM banks WHERE id = ?').get(req.params.id);
  if (!bank) return res.status(404).json({ error: 'Bank not found.' });
  const { from, to } = req.query;
  let sql = 'SELECT * FROM bank_transactions WHERE bank_id = ?';
  const params = [req.params.id];
  if (from) { sql += ' AND transaction_date >= ?'; params.push(from); }
  if (to) { sql += ' AND transaction_date <= ?'; params.push(to); }
  sql += ' ORDER BY transaction_date, id';
  const rows = db.prepare(sql).all(...params);
  const ob = parseFloat(bank.opening_balance) || 0;
  let running = ob;
  const stmt = rows.map(t => {
    const amt = parseFloat(t.amount) || 0;
    const cr = ['deposit', 'transfer_in'].includes(t.type);
    running += cr ? amt : -amt;
    return { ...t, debit: cr ? 0 : amt, credit: cr ? amt : 0, balance: running };
  });
  res.json({ bank: { ...bank, opening_balance: ob, calculated_balance: running }, statement: stmt });
});

router.post('/', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'banks', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, account_number, opening_balance } = req.body;
    const r = db.prepare(`
      INSERT INTO banks (name, account_number, opening_balance) VALUES (?, ?, ?)
    `).run(name, account_number || null, parseFloat(opening_balance) || 0);
    res.status(201).json({ id: r.lastInsertRowid, name, opening_balance: parseFloat(opening_balance) || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'banks', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { name, account_number, opening_balance } = req.body;
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (account_number !== undefined) { updates.push('account_number = ?'); params.push(account_number); }
    if (opening_balance !== undefined) { updates.push('opening_balance = ?'); params.push(parseFloat(opening_balance)); }
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE banks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/transactions', authenticate, requireNotAuditor, logActivity('bank_transaction', 'banks', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, transaction_date, reference, description } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount.' });
    const valid = ['deposit', 'withdrawal', 'payment', 'transfer_in', 'transfer_out'];
    if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    const voucher = getNextVoucherNumber();
    const voucherRef = appendVoucherNote(reference, voucher);
    const r = db.prepare(`
      INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, type, amt, transaction_date || new Date().toISOString().slice(0, 10), voucherRef || null, description || null);
    res.status(201).json({ id: r.lastInsertRowid, type, amount: amt, balance: balance(parseInt(id)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/transfer', authenticate, requireNotAuditor, logActivity('transfer', 'banks', req => 'between banks'), (req, res) => {
  try {
    const { from_bank_id, to_bank_id, amount, transaction_date, description } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || from_bank_id === to_bank_id) return res.status(400).json({ error: 'Invalid transfer.' });
    const d = transaction_date || new Date().toISOString().slice(0, 10);
    const voucher = getNextVoucherNumber();
    const outRef = appendVoucherNote(`transfer-to-${to_bank_id}`, voucher);
    const inRef = appendVoucherNote(`transfer-from-${from_bank_id}`, voucher);
    db.prepare(`
      INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
      VALUES (?, 'transfer_out', ?, ?, ?, ?)
    `).run(from_bank_id, amt, d, outRef, description || 'Bank transfer');
    db.prepare(`
      INSERT INTO bank_transactions (bank_id, type, amount, transaction_date, reference, description)
      VALUES (?, 'transfer_in', ?, ?, ?, ?)
    `).run(to_bank_id, amt, d, inRef, description || 'Bank transfer');
    res.status(201).json({ ok: true, amount: amt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
