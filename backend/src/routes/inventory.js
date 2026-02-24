import { Router } from 'express';
import db from '../db/database.js';
import { authenticate, requireRole, requireNotAuditor } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

router.get('/products', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY name').all();
  res.json(rows);
});

router.get('/products/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found.' });
  res.json(row);
});

router.post('/products', authenticate, requireNotAuditor, logActivity('create', 'inventory', req => req.body?.name || ''), (req, res) => {
  try {
    const { name, sku, unit_price } = req.body;
    const r = db.prepare(`
      INSERT INTO products (name, sku, unit_price) VALUES (?, ?, ?)
    `).run(name, sku || null, parseFloat(unit_price) || 0);
    res.status(201).json({ id: r.lastInsertRowid, name, sku, unit_price: parseFloat(unit_price) || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/products/:id', authenticate, requireNotAuditor, logActivity('update', 'inventory', req => req.params.id), (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    ['name', 'sku', 'unit_price'].forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ error: 'No updates.' });
    params.push(id);
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/products/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'inventory', req => req.params.id), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/sales', authenticate, (req, res) => {
  const { product_id, branch_id, from, to } = req.query;
  let sql = `
    SELECT i.*, p.name as product_name, p.sku, p.unit_price as product_unit_price, b.name as branch_name
    FROM inventory_sales i
    LEFT JOIN products p ON i.product_id = p.id
    LEFT JOIN branches b ON i.branch_id = b.id WHERE 1=1
  `;
  const params = [];
  if (product_id) { sql += ' AND i.product_id = ?'; params.push(product_id); }
  if (branch_id) { sql += ' AND i.branch_id = ?'; params.push(branch_id); }
  if (from) { sql += ' AND i.sale_date >= ?'; params.push(from); }
  if (to) { sql += ' AND i.sale_date <= ?'; params.push(to); }
  sql += ' ORDER BY i.sale_date DESC, i.id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/sales/summary', authenticate, (req, res) => {
  const { product_id, branch_id, from, to } = req.query;
  let sql = `
    SELECT i.product_id, p.name as product_name, p.sku,
      SUM(i.quantity) as total_quantity_sold,
      SUM(i.total) as total_amount
    FROM inventory_sales i
    LEFT JOIN products p ON i.product_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (product_id) { sql += ' AND i.product_id = ?'; params.push(product_id); }
  if (branch_id) { sql += ' AND i.branch_id = ?'; params.push(branch_id); }
  if (from) { sql += ' AND i.sale_date >= ?'; params.push(from); }
  if (to) { sql += ' AND i.sale_date <= ?'; params.push(to); }
  sql += ' GROUP BY i.product_id, p.name, p.sku ORDER BY total_quantity_sold DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.post('/sales', authenticate, requireNotAuditor, logActivity('create', 'inventory_sales', req => req.body?.product_id || ''), (req, res) => {
  try {
    const { product_id, branch_id, sale_date, quantity, unit_price } = req.body;
    const qty = parseInt(quantity) || 0;
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Invalid quantity.' });
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const up = unit_price !== undefined ? parseFloat(unit_price) : (parseFloat(product.unit_price) || 0);
    const total = qty * up;
    const saleDate = sale_date || new Date().toISOString().slice(0, 10);
    const branchId = branch_id || null;

    const existing = db.prepare(`
      SELECT id, quantity, unit_price, total FROM inventory_sales
      WHERE product_id = ? AND sale_date = ? AND ((branch_id IS NULL AND ? IS NULL) OR (branch_id = ?))
      LIMIT 1
    `).get(product_id, saleDate, branchId, branchId);

    if (existing) {
      const newQty = (existing.quantity || 0) + qty;
      const existingUp = parseFloat(existing.unit_price) || 0;
      const newTotal = newQty * existingUp;
      db.prepare('UPDATE inventory_sales SET quantity = ?, total = ?, unit_price = ? WHERE id = ?')
        .run(newQty, newTotal, existingUp, existing.id);
      return res.status(201).json({ id: existing.id, quantity: newQty, unit_price: existingUp, total: newTotal, merged: true });
    }

    const r = db.prepare(`
      INSERT INTO inventory_sales (product_id, branch_id, sale_date, quantity, unit_price, total)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(product_id, branchId, saleDate, qty, up, total);
    res.status(201).json({ id: r.lastInsertRowid, quantity: qty, unit_price: up, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/sales/:id', authenticate, requireNotAuditor, logActivity('update', 'inventory_sales', req => req.params.id), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM inventory_sales WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sale not found.' });
    const { sale_date, quantity, unit_price } = req.body;
    const qty = quantity !== undefined ? parseInt(quantity) : existing.quantity;
    const up = unit_price !== undefined ? parseFloat(unit_price) : (parseFloat(existing.unit_price) || 0);
    const total = qty * up;
    db.prepare('UPDATE inventory_sales SET sale_date=?, quantity=?, unit_price=?, total=? WHERE id=?').run(
      sale_date ?? existing.sale_date,
      qty,
      up,
      total,
      req.params.id
    );
    res.json({ ok: true, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/sales/:id', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('delete', 'inventory_sales', req => req.params.id), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM inventory_sales WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Sale not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
