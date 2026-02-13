import db from '../db/database.js';

export const getNextVoucherNumber = () => {
  const prefix = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('voucher_prefix')?.value || 'VCH';
  const counterRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('voucher_counter');
  const next = parseInt(counterRow?.value || '1', 10);
  const voucher = `${prefix}-${String(next).padStart(6, '0')}`;
  db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('voucher_counter', String(next + 1));
  return voucher;
};

export const appendVoucherNote = (value, voucher) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return voucher;
  if (trimmed.includes(voucher)) return trimmed;
  return `${voucher} - ${trimmed}`;
};
