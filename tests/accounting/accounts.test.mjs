import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountingDb } from '../../server/accounting/sqlite.js';
import { seedBusinessAccounts, getAccountId } from '../../server/accounting/accounts.js';

function fresh(t) {
  const dir = mkdtempSync(join(tmpdir(), 'freegst-coa-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openAccountingDb({ dataDir: dir });
  t.after(() => db.close());
  return db;
}

function addBusiness(db, id, name) {
  db.prepare('INSERT INTO businesses (id,name,created_at) VALUES (?,?,?)')
    .run(id,name,'2026-10-29T00:00:00.000Z');
}

test('seeded Indian chart contains receivables, cash, bank, GST output controls and income', t => {
  const db = fresh(t); addBusiness(db,'biz-1','Acme');
  const codes = seedBusinessAccounts(db,'biz-1');
  for (const code of ['1000','1010','1100','1200','2000','2100','2110','2120','2130','2140','3000','4000','5000','6000']) {
    assert.ok(codes.includes(code), `${code} required`);
    assert.equal(typeof getAccountId(db,'biz-1',code), 'string');
  }
  const row = db.prepare('SELECT kind,normal_balance FROM accounts WHERE business_id=? AND account_code=?').get('biz-1','4000');
  assert.deepEqual({ kind:row.kind, normal_balance:row.normal_balance }, { kind:'income', normal_balance:'credit' });
});

test('repeat seeding preserves account IDs and does not duplicate chart rows', t => {
  const db = fresh(t); addBusiness(db,'biz-1','Acme');
  const original = seedBusinessAccounts(db,'biz-1');
  const oldId = getAccountId(db,'biz-1','1100');
  const repeated = seedBusinessAccounts(db,'biz-1');
  assert.deepEqual(repeated, original);
  assert.equal(getAccountId(db,'biz-1','1100'),oldId);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE business_id=?').get('biz-1').n, original.length);
});

test('business chart is scoped by immutable business ID', t => {
  const db = fresh(t); addBusiness(db,'biz-1','Acme'); addBusiness(db,'biz-2','Bravo');
  seedBusinessAccounts(db,'biz-1'); seedBusinessAccounts(db,'biz-2');
  assert.notEqual(getAccountId(db,'biz-1','1100'), getAccountId(db,'biz-2','1100'));
  assert.throws(() => getAccountId(db,'missing','1100'), /not found|business/i);
  const otherCount = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE business_id=?').get('biz-2').n;
  assert.ok(otherCount > 0);
});
