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
// Disable strict foreign key enforcement to avoid runtime FK issues on complex updates.
db.pragma('foreign_keys = OFF');

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
ensureColumnExists('sales', 'bank_id', 'INTEGER REFERENCES banks(id)');

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

// Sale bank splits table (for multiple bank allocations per sale)
const hasSaleBankSplits = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sale_bank_splits'").get();
if (!hasSaleBankSplits) {
  db.exec(`
    CREATE TABLE sale_bank_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      bank_id INTEGER,
      amount REAL NOT NULL
    );
  `);
} else {
  // If the table exists with foreign keys, recreate it without them to avoid FK errors
  const fkInfo = db.prepare("PRAGMA foreign_key_list('sale_bank_splits')").all();
  if (fkInfo.length) {
    db.exec(`
      ALTER TABLE sale_bank_splits RENAME TO _old_sale_bank_splits;
      CREATE TABLE sale_bank_splits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER,
        bank_id INTEGER,
        amount REAL NOT NULL
      );
      INSERT INTO sale_bank_splits (id, sale_id, bank_id, amount)
      SELECT id, sale_id, bank_id, amount FROM _old_sale_bank_splits;
      DROP TABLE _old_sale_bank_splits;
    `);
  }
}

export default db;
