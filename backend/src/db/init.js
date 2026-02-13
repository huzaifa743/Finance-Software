import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../../data/finance.db');
const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
-- Users & Roles
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  permissions TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  branch_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  ip TEXT,
  user_agent TEXT,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT,
  module TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Branches
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  location TEXT,
  manager_user_id INTEGER REFERENCES users(id),
  opening_date DATE,
  closing_date DATE,
  opening_cash REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Financial year, currency, tax, etc.
INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('financial_year_start', '2025-01-01'),
  ('financial_year_end', '2025-12-31'),
  ('currency', 'PKR'),
  ('country', 'PK'),
  ('tax_rate', '18'),
  ('invoice_prefix', 'INV'),
  ('voucher_prefix', 'VCH'),
  ('invoice_counter', '1'),
  ('voucher_counter', '1'),
  ('language', 'en'),
  ('notification_alerts', '1'),
  ('cloud_backup', '0'),
  ('report_email_auto', '0'),
  ('report_email_manual', '1'),
  ('report_whatsapp_auto', '0'),
  ('report_whatsapp_manual', '1'),
  ('report_email_recipients', ''),
  ('report_whatsapp_numbers', ''),
  ('report_auto_time', '09:00'),
  ('report_auto_timezone', 'UTC'),
  ('report_auto_type', 'summary'),
  ('drive_enabled', '0'),
  ('drive_folder_id', ''),
  ('translate_enabled', '0');

-- Expense categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'variable',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Banks
CREATE TABLE IF NOT EXISTS banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_number TEXT,
  opening_balance REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Customers (for receivables)
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products / Inventory
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT,
  unit_price REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  sale_date DATE NOT NULL,
  type TEXT DEFAULT 'cash',
  cash_amount REAL DEFAULT 0,
  bank_amount REAL DEFAULT 0,
  credit_amount REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  returns_amount REAL DEFAULT 0,
  net_sales REAL DEFAULT 0,
  remarks TEXT,
  is_locked INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER REFERENCES sales(id),
  filename TEXT,
  path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Receivables (Credit sales / Udhaar)
CREATE TABLE IF NOT EXISTS receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  sale_id INTEGER REFERENCES sales(id),
  branch_id INTEGER REFERENCES branches(id),
  amount REAL NOT NULL,
  due_date DATE,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receivable_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receivable_id INTEGER REFERENCES receivables(id),
  amount REAL NOT NULL,
  recovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT
);

-- Purchases
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  branch_id INTEGER REFERENCES branches(id),
  invoice_no TEXT,
  purchase_date DATE NOT NULL,
  due_date DATE,
  total_amount REAL NOT NULL,
  paid_amount REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  category_id INTEGER REFERENCES expense_categories(id),
  amount REAL NOT NULL,
  expense_date DATE NOT NULL,
  type TEXT DEFAULT 'variable',
  is_recurring INTEGER DEFAULT 0,
  remarks TEXT,
  status TEXT DEFAULT 'approved',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER REFERENCES expenses(id),
  filename TEXT,
  path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cash management (daily opening/closing)
CREATE TABLE IF NOT EXISTS cash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  entry_date DATE NOT NULL,
  opening_cash REAL DEFAULT 0,
  closing_cash REAL DEFAULT 0,
  sales_cash REAL DEFAULT 0,
  expense_cash REAL DEFAULT 0,
  bank_deposit REAL DEFAULT 0,
  bank_withdrawal REAL DEFAULT 0,
  difference REAL DEFAULT 0,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, entry_date)
);

-- Bank transactions
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER REFERENCES banks(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_date DATE NOT NULL,
  reference TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Staff
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  fixed_salary REAL DEFAULT 0,
  commission_rate REAL DEFAULT 0,
  contact TEXT,
  joined_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER REFERENCES staff(id),
  month_year TEXT NOT NULL,
  base_salary REAL,
  commission REAL DEFAULT 0,
  advances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  net_salary REAL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inventory / Product sales
CREATE TABLE IF NOT EXISTS inventory_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id),
  branch_id INTEGER REFERENCES branches(id),
  sale_date DATE NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL,
  total REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Payment records (supplier payments, etc.)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  reference_id INTEGER,
  reference_type TEXT,
  amount REAL NOT NULL,
  payment_date DATE NOT NULL,
  mode TEXT DEFAULT 'cash',
  bank_id INTEGER REFERENCES banks(id),
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Roles
INSERT OR IGNORE INTO roles (id, name, permissions) VALUES
  (1, 'Super Admin', 'all'),
  (2, 'Finance Manager', 'branches,sales,purchases,expenses,bank,cash,reports'),
  (3, 'Branch Manager', 'branch_sales,branch_expenses,branch_cash'),
  (4, 'Data Entry Operator', 'sales,expenses,data_entry'),
  (5, 'Auditor', 'read_only');
`);

// Create Super Admin user (password: admin123)
const bcrypt = await import('bcryptjs');
const hash = await bcrypt.default.hash('admin123', 10);
db.prepare(`
  INSERT OR IGNORE INTO users (id, email, password, name, role_id) 
  VALUES (1, 'admin@finance.com', ?, 'Super Admin', 1)
`).run(hash);

// Seed expense categories
db.exec(`
  INSERT OR IGNORE INTO expense_categories (name, type) VALUES
  ('Rent', 'fixed'),
  ('Utilities', 'variable'),
  ('Salaries', 'fixed'),
  ('Office Supplies', 'variable'),
  ('Marketing', 'variable'),
  ('Miscellaneous', 'variable');
`);

db.close();
console.log('Database initialized at', dbPath);
