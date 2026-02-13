import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT secret not configured.' });
    }
    const { email, password } = req.body;
    const identifier = String(email || '').trim();
    const lookup = identifier.toLowerCase() === 'admin' ? 'admin@finance.com' : identifier;
    const user = db.prepare(
      'SELECT u.*, r.name as role_name, r.permissions FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.email = ? AND u.is_active = 1'
    ).get(lookup);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    db.prepare(
      'INSERT INTO login_history (user_id, ip, user_agent) VALUES (?, ?, ?)'
    ).run(user.id, req.ip || req.connection?.remoteAddress, req.get('User-Agent') || '');
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { password: _, ...safe } = user;
    res.json({ token, user: safe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  const u = db.prepare(
    'SELECT u.id, u.email, u.name, u.role_id, u.branch_id, r.name as role_name, r.permissions FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?'
  ).get(req.user.id);
  res.json(u);
});

router.get('/roles', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM roles').all();
  res.json(rows);
});

router.get('/users', authenticate, requireRole('Super Admin', 'Finance Manager', 'Auditor'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.name, u.role_id, u.branch_id, u.is_active, u.created_at,
           r.name as role_name, b.name as branch_name
    FROM users u LEFT JOIN roles r ON u.role_id = r.id LEFT JOIN branches b ON u.branch_id = b.id
    ORDER BY u.id
  `).all();
  res.json(rows);
});

router.post('/users', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('create', 'users', req => JSON.stringify(req.body)), async (req, res) => {
  try {
    const { email, password, name, role_id, branch_id } = req.body;
    const hash = await bcrypt.hash(password || 'user123', 10);
    const r = db.prepare(
      'INSERT INTO users (email, password, name, role_id, branch_id) VALUES (?, ?, ?, ?, ?)'
    ).run(email, hash, name, role_id || 4, branch_id || null);
    res.status(201).json({ id: r.lastInsertRowid, email, name, role_id, branch_id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already exists.' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/users/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('update', 'users', req => `${req.params.id}`), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role_id, branch_id, is_active, password } = req.body;
    const updates = [];
    const params = [];
    if (name != null) { updates.push('name = ?'); params.push(name); }
    if (role_id != null) { updates.push('role_id = ?'); params.push(role_id); }
    if (branch_id != null) { updates.push('branch_id = ?'); params.push(branch_id); }
    if (is_active != null) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      params.push(hash);
    }
    if (!updates.length) return res.status(400).json({ error: 'No updates provided.' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/login-history', authenticate, requireRole('Super Admin', 'Finance Manager', 'Auditor'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT l.*, u.email, u.name FROM login_history l
    JOIN users u ON l.user_id = u.id
    ORDER BY l.login_at DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

router.get('/activity-logs', authenticate, requireRole('Super Admin', 'Finance Manager', 'Auditor'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const module = req.query.module;
  let sql = `
    SELECT a.*, u.email, u.name FROM activity_logs a
    LEFT JOIN users u ON a.user_id = u.id
  `;
  const params = [];
  if (module) {
    sql += ' WHERE a.module = ?';
    params.push(module);
  }
  sql += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

export default router;
