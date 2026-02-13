import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '../../data/finance.db');

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

export default db;
