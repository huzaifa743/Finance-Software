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

export default db;
