import { Router } from 'express';
import nodemailer from 'nodemailer';
import { TranslationServiceClient } from '@google-cloud/translate';
import { google } from 'googleapis';
import db from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { logActivity } from '../middleware/activityLog.js';

const router = Router();

const supportedValues = (type) => {
  try {
    return Intl.supportedValuesOf ? Intl.supportedValuesOf(type) : [];
  } catch {
    return [];
  }
};

const displayNames = (type) => {
  try {
    return new Intl.DisplayNames(['en'], { type });
  } catch {
    return null;
  }
};

const getCurrencies = () => {
  const dn = displayNames('currency');
  const list = supportedValues('currency')
    .map((code) => ({ code, name: dn?.of(code) || code }))
    .filter((x) => x.name);
  return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

const getLanguages = () => {
  const dn = displayNames('language');
  const list = supportedValues('language')
    .map((code) => ({ code, name: dn?.of(code) || code }))
    .filter((x) => x.name);
  return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

const getCountries = () => {
  const dn = displayNames('region');
  const list = supportedValues('region')
    .map((code) => ({ code, name: dn?.of(code) || code, taxRate: null }))
    .filter((x) => x.name);
  return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
};

const translateCache = new Map();
const getTranslateClient = () => {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  return { client: new TranslationServiceClient(), projectId };
};

const translateTexts = async (texts, target) => {
  if (!target || target === 'en') return texts;
  const keyPrefix = `${target}::`;
  const pending = [];
  const results = texts.map((t) => {
    const key = keyPrefix + t;
    if (translateCache.has(key)) return translateCache.get(key);
    pending.push(t);
    return null;
  });
  if (!pending.length) return results;
  const tc = getTranslateClient();
  if (!tc) return texts;
  const location = process.env.GOOGLE_TRANSLATE_LOCATION || 'global';
  const [response] = await tc.client.translateText({
    parent: `projects/${tc.projectId}/locations/${location}`,
    contents: pending,
    mimeType: 'text/plain',
    targetLanguageCode: target,
  });
  const translated = response.translations?.map((t) => t.translatedText) || [];
  pending.forEach((t, i) => translateCache.set(keyPrefix + t, translated[i] || t));
  return texts.map((t) => translateCache.get(keyPrefix + t) || t);
};

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.get('/countries', authenticate, (req, res) => {
  res.json(getCountries());
});

router.get('/currencies', authenticate, (req, res) => {
  res.json(getCurrencies());
});

router.get('/languages', authenticate, (req, res) => {
  res.json(getLanguages());
});

router.post('/translate', async (req, res) => {
  try {
    const { texts, target } = req.body || {};
    if (!Array.isArray(texts) || !texts.length) return res.status(400).json({ error: 'texts array required' });
    const s = getSettingsMap();
    if (String(s.translate_enabled || '0') !== '1') {
      return res.json({ translations: texts.map((t) => String(t || '')) });
    }
    const out = await translateTexts(texts.map((t) => String(t || '')), String(target || 'en'));
    res.json({ translations: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function buildReportData(reportType, { date, month, year, from, to, branch_id }) {
  const today = new Date().toISOString().slice(0, 10);
  const m = month || String(new Date().getMonth() + 1);
  const y = year || String(new Date().getFullYear());
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const bp = branch_id ? [branch_id] : [];

  if (reportType === 'summary') {
    const salesToday = db.prepare('SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date = ?').get(today);
    let salesMonthSql = 'SELECT COALESCE(SUM(net_sales), 0) as t FROM sales WHERE sale_date >= ? AND sale_date <= ?';
    const salesMonthParams = [monthStart, monthEnd, ...bp];
    if (branch_id) salesMonthSql += ' AND branch_id = ?';
    const salesMonth = db.prepare(salesMonthSql).get(...salesMonthParams);
    let expSql = 'SELECT COALESCE(SUM(amount), 0) as t FROM expenses WHERE expense_date >= ? AND expense_date <= ?';
    const expParams = [monthStart, monthEnd, ...bp];
    if (branch_id) expSql += ' AND branch_id = ?';
    const exp = db.prepare(expSql).get(...expParams);
    let purchSql = 'SELECT COALESCE(SUM(total_amount), 0) as t FROM purchases WHERE purchase_date >= ? AND purchase_date <= ?';
    const purchParams = [monthStart, monthEnd, ...bp];
    if (branch_id) purchSql += ' AND branch_id = ?';
    const purch = db.prepare(purchSql).get(...purchParams);
    const gross = parseFloat(salesMonth?.t) || 0;
    const cost = parseFloat(purch?.t) || 0;
    const expTotal = parseFloat(exp?.t) || 0;
    const netProfit = gross - cost - expTotal;
    let cashSql = 'SELECT COALESCE(SUM(closing_cash), 0) as t FROM cash_entries WHERE entry_date = ?';
    const cashParams = [today, ...bp];
    if (branch_id) cashSql += ' AND branch_id = ?';
    const cashRows = db.prepare(cashSql).all(...cashParams);
    const cashInHand = cashRows.reduce((a, r) => a + (parseFloat(r.t) || 0), 0);
    const banks = db.prepare('SELECT id, opening_balance FROM banks').all();
    let bankBal = 0;
    for (const b of banks) {
      const dep = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('deposit', 'transfer_in')").get(b.id);
      const wit = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM bank_transactions WHERE bank_id = ? AND type IN ('withdrawal', 'payment', 'transfer_out')").get(b.id);
      bankBal += (parseFloat(b.opening_balance) || 0) + (parseFloat(dep?.t) || 0) - (parseFloat(wit?.t) || 0);
    }
    const recv = db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM receivables WHERE status = 'pending'").get();
    const pay = db.prepare('SELECT COALESCE(SUM(balance), 0) as t FROM purchases WHERE balance > 0').get();
    return { reportType: 'summary', date: today, salesToday: parseFloat(salesToday?.t) || 0, salesMonth: gross, netProfit, cashInHand, bankBalance: bankBal, receivables: parseFloat(recv?.t) || 0, payables: parseFloat(pay?.t) || 0 };
  }

  if (reportType === 'daily_sales') {
    const d = date || today;
    let sql = 'SELECT s.*, b.name as branch_name FROM sales s LEFT JOIN branches b ON s.branch_id = b.id WHERE s.sale_date = ?';
    const params = [d, ...bp];
    if (branch_id) sql += ' AND s.branch_id = ?';
    sql += ' ORDER BY s.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.net_sales) || 0), 0);
    return { reportType: 'daily_sales', date: d, rows, total };
  }

  if (reportType === 'daily_purchases') {
    const d = date || today;
    let sql = `
      SELECT p.*, s.name as supplier_name, b.name as branch_name FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN branches b ON p.branch_id = b.id
      WHERE p.purchase_date = ?
    `;
    const params = [d, ...bp];
    if (branch_id) sql += ' AND p.branch_id = ?';
    sql += ' ORDER BY p.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
    return { reportType: 'daily_purchases', date: d, rows, total };
  }

  if (reportType === 'monthly_purchases') {
    let sql = `
      SELECT p.purchase_date, SUM(p.total_amount) as daily_total, p.branch_id, b.name as branch_name
      FROM purchases p LEFT JOIN branches b ON p.branch_id = b.id
      WHERE p.purchase_date >= ? AND p.purchase_date <= ?
    `;
    const params = [monthStart, monthEnd, ...bp];
    if (branch_id) sql += ' AND p.branch_id = ?';
    sql += ' GROUP BY p.purchase_date, p.branch_id ORDER BY p.purchase_date, p.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
    return { reportType: 'monthly_purchases', month: m, year: y, from: monthStart, to: monthEnd, rows, total };
  }

  if (reportType === 'monthly_sales') {
    let sql = 'SELECT s.sale_date, SUM(s.net_sales) as daily_total, s.branch_id, b.name as branch_name FROM sales s LEFT JOIN branches b ON s.branch_id = b.id WHERE s.sale_date >= ? AND s.sale_date <= ?';
    const params = [monthStart, monthEnd, ...bp];
    if (branch_id) sql += ' AND s.branch_id = ?';
    sql += ' GROUP BY s.sale_date, s.branch_id ORDER BY s.sale_date, s.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
    return { reportType: 'monthly_sales', month: m, year: y, from: monthStart, to: monthEnd, rows, total };
  }

  if (reportType === 'daily_expenses') {
    const d = date || today;
    let sql = 'SELECT e.*, c.name as category_name, b.name as branch_name FROM expenses e LEFT JOIN expense_categories c ON e.category_id = c.id LEFT JOIN branches b ON e.branch_id = b.id WHERE e.expense_date = ?';
    const params = [d, ...bp];
    if (branch_id) sql += ' AND e.branch_id = ?';
    sql += ' ORDER BY e.branch_id, e.category_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
    return { reportType: 'daily_expenses', date: d, rows, total };
  }

  if (reportType === 'monthly_expenses') {
    let sql = 'SELECT e.expense_date, SUM(e.amount) as daily_total, e.branch_id, b.name as branch_name FROM expenses e LEFT JOIN branches b ON e.branch_id = b.id WHERE e.expense_date >= ? AND e.expense_date <= ?';
    const params = [monthStart, monthEnd, ...bp];
    if (branch_id) sql += ' AND e.branch_id = ?';
    sql += ' GROUP BY e.expense_date, e.branch_id ORDER BY e.expense_date, e.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.daily_total) || 0), 0);
    return { reportType: 'monthly_expenses', month: m, year: y, from: monthStart, to: monthEnd, rows, total };
  }

  if (reportType === 'category_expenses') {
    const params = [];
    let sql = `
      SELECT c.name as category_name, c.type, COALESCE(SUM(e.amount), 0) as total
      FROM expense_categories c
      LEFT JOIN expenses e ON e.category_id = c.id
    `;
    const conditions = [];
    if (from) { conditions.push('e.expense_date >= ?'); params.push(from); }
    if (to) { conditions.push('e.expense_date <= ?'); params.push(to); }
    if (branch_id) { conditions.push('e.branch_id = ?'); params.push(branch_id); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' GROUP BY c.id, c.name, c.type ORDER BY total DESC';
    const rows = db.prepare(sql).all(...params);
    return { reportType: 'category_expenses', from: from || null, to: to || null, rows, total: null };
  }

  if (reportType === 'date_range_sales' && from && to) {
    let sql = 'SELECT s.*, b.name as branch_name FROM sales s LEFT JOIN branches b ON s.branch_id = b.id WHERE s.sale_date >= ? AND s.sale_date <= ?';
    const params = [from, to, ...bp];
    if (branch_id) sql += ' AND s.branch_id = ?';
    sql += ' ORDER BY s.sale_date DESC, s.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.net_sales) || 0), 0);
    return { reportType: 'date_range_sales', from, to, rows, total };
  }

  if (reportType === 'date_range_purchases' && from && to) {
    let sql = `
      SELECT p.*, s.name as supplier_name, b.name as branch_name FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN branches b ON p.branch_id = b.id
      WHERE p.purchase_date >= ? AND p.purchase_date <= ?
    `;
    const params = [from, to, ...bp];
    if (branch_id) sql += ' AND p.branch_id = ?';
    sql += ' ORDER BY p.purchase_date DESC, p.branch_id';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.total_amount) || 0), 0);
    return { reportType: 'date_range_purchases', from, to, rows, total };
  }

  if (reportType === 'inventory' && from && to) {
    let sql = `
      SELECT i.*, p.name as product_name, b.name as branch_name
      FROM inventory_sales i
      LEFT JOIN products p ON i.product_id = p.id
      LEFT JOIN branches b ON i.branch_id = b.id
      WHERE i.sale_date >= ? AND i.sale_date <= ?
    `;
    const params = [from, to, ...bp];
    if (branch_id) sql += ' AND i.branch_id = ?';
    sql += ' ORDER BY i.sale_date DESC, i.id DESC';
    const rows = db.prepare(sql).all(...params);
    const total = rows.reduce((a, r) => a + (parseFloat(r.total) || 0), 0);
    return { reportType: 'inventory', from, to, rows, total };
  }

  return buildReportData('summary', { date, month, year, from, to, branch_id });
}

function reportToHtml(data) {
  if (data.reportType === 'summary') {
    return `<h2>Finance Report — Summary</h2><p>Date: ${data.date}</p><ul>
      <li>Sales today: ${data.salesToday}</li><li>Sales (month): ${data.salesMonth}</li>
      <li>Net profit: ${data.netProfit}</li><li>Cash in hand: ${data.cashInHand}</li>
      <li>Bank balance: ${data.bankBalance}</li><li>Receivables: ${data.receivables}</li><li>Payables: ${data.payables}</li>
    </ul>`;
  }
  if (data.reportType === 'daily_sales') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.branch_name || '-'}</td><td>${r.net_sales}</td></tr>`).join('');
    return `<h2>Daily Sales Report</h2><p>Date: ${data.date}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Branch</th><th>Net Sales</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'monthly_sales') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.sale_date}</td><td>${r.branch_name || '-'}</td><td>${r.daily_total}</td></tr>`).join('');
    return `<h2>Monthly Sales Report</h2><p>${data.month}/${data.year} (${data.from} – ${data.to})</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Branch</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'daily_expenses') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.branch_name || '-'}</td><td>${r.category_name || '-'}</td><td>${r.amount}</td></tr>`).join('');
    return `<h2>Daily Expenses Report</h2><p>Date: ${data.date}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Branch</th><th>Category</th><th>Amount</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'monthly_expenses') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.expense_date}</td><td>${r.branch_name || '-'}</td><td>${r.daily_total}</td></tr>`).join('');
    return `<h2>Monthly Expenses Report</h2><p>${data.month}/${data.year}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Branch</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'date_range_sales') {
    let rows = (data.rows || []).slice(0, 50).map(r => `<tr><td>${r.sale_date}</td><td>${r.branch_name || '-'}</td><td>${r.net_sales}</td></tr>`).join('');
    return `<h2>Date-Range Sales Report</h2><p>${data.from} – ${data.to}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Branch</th><th>Net Sales</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'daily_purchases') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.branch_name || '-'}</td><td>${r.supplier_name || '-'}</td><td>${r.total_amount}</td></tr>`).join('');
    return `<h2>Daily Purchase Report</h2><p>Date: ${data.date}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Branch</th><th>Supplier</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'monthly_purchases') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.purchase_date}</td><td>${r.branch_name || '-'}</td><td>${r.daily_total}</td></tr>`).join('');
    return `<h2>Monthly Purchase Report</h2><p>${data.month}/${data.year} (${data.from} – ${data.to})</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Branch</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'category_expenses') {
    let rows = (data.rows || []).map(r => `<tr><td>${r.category_name || '-'}</td><td>${r.type || '-'}</td><td>${r.total}</td></tr>`).join('');
    return `<h2>Category-wise Expense Report</h2><p>${data.from || ''} – ${data.to || ''}</p><table border="1"><tr><th>Category</th><th>Type</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'date_range_purchases') {
    let rows = (data.rows || []).slice(0, 50).map(r => `<tr><td>${r.purchase_date}</td><td>${r.branch_name || '-'}</td><td>${r.total_amount}</td></tr>`).join('');
    return `<h2>Date-Range Purchase Report</h2><p>${data.from} – ${data.to}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Branch</th><th>Total</th></tr>${rows}</table>`;
  }
  if (data.reportType === 'inventory') {
    let rows = (data.rows || []).slice(0, 50).map(r => `<tr><td>${r.sale_date}</td><td>${r.product_name || '-'}</td><td>${r.quantity}</td><td>${r.total}</td></tr>`).join('');
    return `<h2>Inventory Sales Report</h2><p>${data.from} – ${data.to}</p><p><strong>Total: ${data.total}</strong></p><table border="1"><tr><th>Date</th><th>Product</th><th>Qty</th><th>Total</th></tr>${rows}</table>`;
  }
  return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
}

function reportToText(data) {
  if (data.reportType === 'summary') {
    return `Finance Report — Summary\nDate: ${data.date}\nSales today: ${data.salesToday}\nSales (month): ${data.salesMonth}\nNet profit: ${data.netProfit}\nCash in hand: ${data.cashInHand}\nBank balance: ${data.bankBalance}\nReceivables: ${data.receivables}\nPayables: ${data.payables}`;
  }
  const rows = data.rows || [];
  const total = data.total != null ? `\nTotal: ${data.total}` : '';
  const header = `Finance Report — ${data.reportType.replace(/_/g, ' ')}`;
  const preview = rows.slice(0, 10).map((r) => JSON.stringify(r)).join('\n');
  return `${header}${total}\nRows: ${rows.length}\n${preview}`.trim();
}

async function sendWhatsAppText(recipients, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    throw new Error('WhatsApp not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env.');
  }
  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  for (const to of recipients) {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error?.message || `WhatsApp send failed (${resp.status})`);
    }
  }
}

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

function getDriveClient() {
  const json = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  const filePath = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH;
  if (!json && !filePath) return null;
  const creds = json ? JSON.parse(json) : undefined;
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    keyFile: filePath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
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

router.post('/backup/cloud', authenticate, requireRole('Super Admin', 'Finance Manager'), async (req, res) => {
  try {
    const drive = getDriveClient();
    if (!drive) return res.status(400).json({ error: 'Google Drive not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH.' });
    const folderId = req.body?.folder_id || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
    const backup = buildBackupPayload();
    const json = JSON.stringify(backup, null, 2);
    const filename = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const fileMetadata = { name: filename, parents: folderId ? [folderId] : undefined };
    const media = { mimeType: 'application/json', body: Buffer.from(json) };
    const r = await drive.files.create({ requestBody: fileMetadata, media, fields: 'id, webViewLink' });
    res.json({ ok: true, fileId: r.data.id, link: r.data.webViewLink || null });
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

router.post('/send-report', authenticate, requireRole('Super Admin', 'Finance Manager'), logActivity('send_report', 'settings', req => req.body?.type || ''), async (req, res) => {
  try {
    const { type, reportType, recipients, date, month, year, from, to, branch_id } = req.body;
    if (!type || !['email', 'whatsapp'].includes(type)) return res.status(400).json({ error: 'type must be email or whatsapp' });
    const rows = db.prepare('SELECT key, value FROM system_settings').all();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    const rec = (recipients || (type === 'email' ? s.report_email_recipients : s.report_whatsapp_numbers) || '').toString().trim();
    if (!rec) return res.status(400).json({ error: 'No recipients. Set email recipients or WhatsApp numbers in settings, or pass "recipients" in request.' });

    const data = buildReportData(reportType || 'summary', { date, month, year, from, to, branch_id: branch_id || null });

    if (type === 'email') {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER && process.env.SMTP_PASS ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return res.status(400).json({ error: 'Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT, SMTP_SECURE) in .env.' });
      }
      const toList = rec.split(/[,;]/).map(e => e.trim()).filter(Boolean);
      const html = reportToHtml(data);
      const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
      for (const toAddr of toList) {
        await transporter.sendMail({
          from: fromAddr,
          to: toAddr,
          subject: `Finance Report: ${data.reportType} – ${new Date().toISOString().slice(0, 10)}`,
          html,
          text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        });
      }
      return res.json({ ok: true, message: `Report (${data.reportType}) sent by email to ${toList.length} recipient(s).` });
    }

    if (type === 'whatsapp') {
      const recipients = rec.split(/[,;]/).map(e => e.trim()).filter(Boolean);
      const message = reportToText(data);
      await sendWhatsAppText(recipients, message);
      return res.json({ ok: true, message: `Report (${data.reportType}) sent to ${recipients.length} WhatsApp recipient(s).` });
    }

    return res.status(400).json({ error: 'type must be email or whatsapp' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM system_settings').all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

function getNowParts(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

async function sendAutoReport(channel, s) {
  const reportType = s.report_auto_type || 'summary';
  const data = buildReportData(reportType, {});
  if (channel === 'email') {
    const rec = (s.report_email_recipients || '').toString().trim();
    if (!rec) return;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER && process.env.SMTP_PASS ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
    const toList = rec.split(/[,;]/).map(e => e.trim()).filter(Boolean);
    const html = reportToHtml(data);
    const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
    for (const toAddr of toList) {
      await transporter.sendMail({
        from: fromAddr,
        to: toAddr,
        subject: `Finance Report: ${data.reportType} – ${new Date().toISOString().slice(0, 10)}`,
        html,
        text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  if (channel === 'whatsapp') {
    const rec = (s.report_whatsapp_numbers || '').toString().trim();
    if (!rec) return;
    const recipients = rec.split(/[,;]/).map(e => e.trim()).filter(Boolean);
    const message = reportToText(data);
    await sendWhatsAppText(recipients, message);
  }
}

let autoReportTimer = null;
let lastSentKey = null;

export function startAutoReportScheduler() {
  if (autoReportTimer) return;
  autoReportTimer = setInterval(async () => {
    try {
      const s = getSettingsMap();
      const time = (s.report_auto_time || '').trim();
      const tz = (s.report_auto_timezone || 'UTC').trim();
      if (!time) return;
      const { date, time: nowTime } = getNowParts(tz);
      if (nowTime !== time) return;
      const key = `${date}:${time}:${s.report_auto_type || 'summary'}`;
      if (lastSentKey === key) return;
      lastSentKey = key;
      if (String(s.report_email_auto) === '1') await sendAutoReport('email', s);
      if (String(s.report_whatsapp_auto) === '1') await sendAutoReport('whatsapp', s);
    } catch (e) {
      // swallow scheduler errors
    }
  }, 30000);
}

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
