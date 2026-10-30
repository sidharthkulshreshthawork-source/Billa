import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** The explicit data directory must be separated from the original app's JSON store. */
export function openAccountingDb({ dataDir }) {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') {
    throw new TypeError('accounting dataDir is required; never fall back to legacy JSON directory');
  }
  const base = resolve(dataDir);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(base, 'accounting.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const existing = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0;
    if (existing > 1) throw new Error('Accounting database requires a newer application version');
    if (existing === 0) {
      transaction(db, () => {
        db.exec(schema);
        db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(1, new Date().toISOString());
      });
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Single-writer atomic boundary for document+ledger+idempotency writes. */
export function transaction(db, work) {
  if (typeof work !== 'function') throw new TypeError('transaction requires synchronous callback');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    if (result && typeof result.then === 'function') {
      throw new TypeError('SQLite transaction callback must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
