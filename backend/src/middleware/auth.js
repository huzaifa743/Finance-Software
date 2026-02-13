import jwt from 'jsonwebtoken';
import db from '../db/database.js';

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare(
      'SELECT u.*, r.name as role_name, r.permissions FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ? AND u.is_active = 1'
    ).get(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found or inactive.' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

export const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.permissions === 'all' || allowed.includes(req.user.role_name)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

/** Block Auditor (read-only role) from create/update/delete. Use on mutation routes. */
export const requireNotAuditor = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role_name === 'Auditor') return res.status(403).json({ error: 'Read-only access. Auditors cannot create, edit, or delete.' });
  next();
};
