import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

function buildBackupPayload() {
  const tables = ['roles', 'branches', 'system_settings', 'expense_categories', 'banks', 'suppliers', 'customers', 'products', 'sales', 'sale_attachments', 'receivables', 'receivable_recoveries', 'purchases', 'expenses', 'expense_attachments', 'cash_entries', 'bank_transactions', 'staff', 'salary_records', 'inventory_sales', 'payments', 'activity_logs', 'login_history'];
  const backup = { exportedAt: new Date().toISOString(), tables: {} };
  const users = db.prepare('SELECT id, email, name, role_id, branch_id, is_active, created_at, updated_at FROM users').all();
  backup.tables.users = users;
  for (const t of tables) {
    try {
      const rows = db.prepare(`SELECT * FROM ${t}`).all();
      backup.tables[t] = rows;
    } catch (e) {
      backup.tables[t] = [];
    }
  }
  return backup;
}

router.get('/backup', authenticate, requireRole('Super Admin', 'Finance Manager'), (req, res) => {
  try {
    const backup = buildBackupPayload();
    const json = JSON.stringify(backup, null, 2);
    const filename = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const RESTORE_DELETE_ORDER = [
  'login_history', 'activity_logs', 'sale_attachments', 'receivable_recoveries', 'expense_attachments',
  'bank_transactions', 'salary_records', 'payments', 'receivables', 'purchases',
  'expenses', 'cash_entries', 'inventory_sales', 'sales', 'staff', 'branches', 'suppliers',
  'customers', 'products', 'expense_categories', 'banks', 'system_settings'
];
const RESTORE_INSERT_ORDER = [
  'branches', 'expense_categories', 'banks', 'suppliers', 'customers', 'products',
  'system_settings', 'sales', 'sale_attachments', 'receivables', 'receivable_recoveries',
  'purchases', 'expenses', 'expense_attachments', 'cash_entries', 'bank_transactions', 'staff',
  'salary_records', 'inventory_sales', 'payments',
  'activity_logs', 'login_history'
];

router.post('/restore', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('restore', 'settings', req => 'backup'), async (req, res) => {
  try {
    const backup = req.body;
    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      return res.status(400).json({ error: 'Invalid backup. Send JSON with { exportedAt, tables: { ... } }.' });
    }
    const tables = backup.tables;
    db.pragma('foreign_keys = OFF');
    try {
      for (const t of RESTORE_DELETE_ORDER) {
        try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) { /* ignore */ }
      }
      for (const t of RESTORE_INSERT_ORDER) {
        const rows = tables[t];
        if (!Array.isArray(rows) || !rows.length) continue;
        const keys = Object.keys(rows[0]);
        const placeholders = keys.map(() => '?').join(',');
        const sql = `INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${placeholders})`;
        const stmt = db.prepare(sql);
        for (const r of rows) {
          try {
            stmt.run(...keys.map(k => r[k] != null ? r[k] : null));
          } catch (e) { /* skip constraint errors */ }
        }
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
    res.json({ ok: true, message: 'Restore complete. Users and roles were not changed.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:key', authenticate, (req, res) => {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'Setting not found.' });
  res.json({ key: req.params.key, value: row.value });
});

router.patch('/:key', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'settings', req => req.params.key), (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value required' });
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
    res.json({ ok: true, key, value: String(value) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/bulk', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('bulk_update', 'settings', req => 'bulk'), (req, res) => {
  try {
    const updates = req.body;
    if (typeof updates !== 'object') return res.status(400).json({ error: 'Object of key-value pairs required' });
    const start = updates.financial_year_start;
    const end = updates.financial_year_end;
    if (start && end && String(start).trim() && String(end).trim()) {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (s > e) return res.status(400).json({ error: 'Financial year start must be on or before end.' });
    }
    const stmt = db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(updates)) stmt.run(k, v === undefined || v === null ? '' : String(v));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
