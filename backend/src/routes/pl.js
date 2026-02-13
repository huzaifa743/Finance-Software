import { Router } from 'express';
import db from '../db/database.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/branch/:branchId', authenticate, (req, res) => {
  const { branchId } = req.params;
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const sales = db.prepare(`
    SELECT COALESCE(SUM(net_sales), 0) as total FROM sales
    WHERE branch_id = ? AND sale_date >= ? AND sale_date <= ?
  `).get(branchId, from, to);
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total FROM purchases
    WHERE branch_id = ? AND purchase_date >= ? AND purchase_date <= ?
  `).get(branchId, from, to);
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expenses
    WHERE branch_id = ? AND expense_date >= ? AND expense_date <= ?
  `).get(branchId, from, to);
  const grossSales = parseFloat(sales?.total) || 0;
  const costOfGoods = parseFloat(purchases?.total) || 0;
  const grossProfit = grossSales - costOfGoods;
  const totalExpenses = parseFloat(expenses?.total) || 0;
  const netProfit = grossProfit - totalExpenses;
  const expenseRatio = grossSales > 0 ? (totalExpenses / grossSales * 100).toFixed(2) : 0;
  res.json({
    branch_id: branchId,
    from,
    to,
    grossSales,
    costOfGoods,
    grossProfit,
    totalExpenses,
    netProfit,
    expenseRatio: parseFloat(expenseRatio),
  });
});

router.get('/consolidated', authenticate, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  const sales = db.prepare(`
    SELECT COALESCE(SUM(net_sales), 0) as total FROM sales
    WHERE sale_date >= ? AND sale_date <= ?
  `).get(from, to);
  const purchases = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total FROM purchases
    WHERE purchase_date >= ? AND purchase_date <= ?
  `).get(from, to);
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expenses
    WHERE expense_date >= ? AND expense_date <= ?
  `).get(from, to);
  const grossSales = parseFloat(sales?.total) || 0;
  const costOfGoods = parseFloat(purchases?.total) || 0;
  const grossProfit = grossSales - costOfGoods;
  const totalExpenses = parseFloat(expenses?.total) || 0;
  const netProfit = grossProfit - totalExpenses;
  const expenseRatio = grossSales > 0 ? (totalExpenses / grossSales * 100).toFixed(2) : 0;
  res.json({
    from,
    to,
    grossSales,
    costOfGoods,
    grossProfit,
    totalExpenses,
    netProfit,
    expenseRatio: parseFloat(expenseRatio),
  });
});

router.get('/monthly-comparison', authenticate, (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(parseInt(y), m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const sales = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?').get(from, to);
    const expenses = db.prepare('SELECT COALESCE(SUM(amount), 0) as t FROM expenses WHERE expense_date >= ? AND expense_date <= ?').get(from, to);
    const purchases = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?').get(from, to);
    const gross = parseFloat(sales?.t) || 0;
    const cost = parseFloat(purchases?.t) || 0;
    const exp = parseFloat(expenses?.t) || 0;
    rows.push({
      month: m,
      year: parseInt(y),
      from,
      to,
      grossSales: gross,
      costOfGoods: cost,
      grossProfit: gross - cost,
      totalExpenses: exp,
      netProfit: gross - cost - exp,
    });
  }
  res.json({ year: parseInt(y), months: rows });
});

router.get('/yearly-summary', authenticate, (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  const sales = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?').get(from, to);
  const purchases = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?').get(from, to);
  const expenses = db.prepare('SELECT COALESCE(SUM(amount), 0) as t FROM expenses WHERE expense_date >= ? AND expense_date <= ?').get(from, to);
  const gross = parseFloat(sales?.t) || 0;
  const cost = parseFloat(purchases?.t) || 0;
  const exp = parseFloat(expenses?.t) || 0;
  res.json({
    year: parseInt(y),
    grossSales: gross,
    costOfGoods: cost,
    grossProfit: gross - cost,
    totalExpenses: exp,
    netProfit: gross - cost - exp,
    expenseRatio: gross > 0 ? (exp / gross * 100).toFixed(2) : 0,
  });
});

export default router;
