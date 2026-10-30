import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountingDb, transaction } from '../../server/accounting/sqlite.js';
import { toPaise } from '../../server/accounting/money.js';

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), 'freegst-accounting-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openAccountingDb({ dataDir: dir });
  t.after(() => db.close());
  return { db, dir };
}

test('initializing a scratch database creates all first-slice financial tables and migration record', t => {
  const { db, dir } = fresh(t);
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(x => x.version), [1]);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
  for (const table of ['businesses','local_users','sessions','accounts','invoice_drafts','posted_invoices','journal_entries','journal_lines','approvals','idempotency_records','audit_events']) {
    assert.ok(names.includes(table), `schema must have ${table}`);
  }
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.ok(existsSync(join(dir, 'accounting.sqlite')));
  assert.deepEqual(readdirSync(dir).filter(n => n.endsWith('.json')), []);
});

test('foreign keys prevent orphan records', t => {
  const { db } = fresh(t);
  assert.throws(() => db.prepare(`INSERT INTO accounts(id, business_id, account_code, name, kind, normal_balance)
    VALUES ('a','missing','1000','Cash','asset','debit')`).run(), /FOREIGN KEY constraint failed/);
});

test('transactions rollback every partial write when a step fails', t => {
  const { db } = fresh(t);
  assert.throws(() => transaction(db, () => {
    db.prepare("INSERT INTO businesses(id,name,created_at) VALUES ('b1','Shop','2026-10-29T00:00:00.000Z')").run();
    throw Error('forced failure');
  }), /forced failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM businesses').get().count, 0);
  transaction(db, () => db.prepare("INSERT INTO businesses(id,name,created_at) VALUES ('b1','Shop','2026-10-29T00:00:00.000Z')").run());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM businesses').get().count, 1);
});

test('reopening an existing database leaves migration state unchanged', t => {
  const { db, dir } = fresh(t);
  const again = openAccountingDb({ dataDir: dir });
  t.after(() => again.close());
  assert.deepEqual(again.prepare('SELECT version FROM schema_migrations').all().map(x => x.version), [1]);
});

test('decimal currency converts to exact integer paise with no floating point ledger rounding', () => {
  assert.equal(toPaise('11800.00'), 1180000);
  assert.equal(toPaise('0.01'), 1);
  assert.equal(toPaise('0'), 0);
  assert.equal(toPaise('100.99'), 10099);
});

test('money conversion rejects nonfinite input, surplus precision and out-of-range values', () => {
  for (const bad of [NaN, Infinity, '-Infinity', 'NaN', '', null, undefined, {}, '0.001', '1e4', '9,999', '90071992547409.92', '-10.00']) {
    assert.throws(() => toPaise(bad), undefined, `must reject ${String(bad)}`);
  }
});
