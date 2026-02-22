import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || join(__dirname, '../../data/finance.db');

if (!fs.existsSync(dbPath)) {
	await import('./init.js');
}

const db = new Database(dbPath);

const hasUsersTable = db
	.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
	.get();
if (!hasUsersTable) {
	await import('./init.js');
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const ensureColumnExists = (tableName, columnName, columnDef) => {
	const table = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(tableName);
	if (!table) return;

	const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
	const hasColumn = columns.some(col => col.name === columnName);
	if (!hasColumn) {
		db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`).run();
	}
};

// Backfill missing columns in existing databases.
ensureColumnExists('purchases', 'due_date', 'DATE');
ensureColumnExists('suppliers', 'phone', 'TEXT');
ensureColumnExists('suppliers', 'vat_number', 'TEXT');
ensureColumnExists('sales', 'customer_id', 'INTEGER REFERENCES customers(id)');

// Purchase attachments table
const hasPurchaseAttachments = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_attachments'").get();
if (!hasPurchaseAttachments) {
  db.exec(`
    CREATE TABLE purchase_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER REFERENCES purchases(id),
      filename TEXT,
      path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Rent and Bills tables
const hasRentBills = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rent_bills'").get();
if (!hasRentBills) {
  db.exec(`
    CREATE TABLE rent_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'bill',
      amount REAL NOT NULL,
      due_date DATE,
      paid_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rent_bill_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rent_bill_id INTEGER REFERENCES rent_bills(id),
      filename TEXT,
      path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export default db;
