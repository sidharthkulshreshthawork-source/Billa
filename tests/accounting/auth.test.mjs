import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openAccountingDb} from '../../server/accounting/sqlite.js';
import {bootstrapLocalOwner,loginLocal,authenticateRequest,revokeLocalSession} from '../../server/accounting/auth.js';
const NOW=Date.parse('2026-10-30T08:00:00Z');
function fresh(t){const dir=mkdtempSync(join(tmpdir(),'billa-auth-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const db=openAccountingDb({dataDir:dir});t.after(()=>db.close());return db;}
function req(s,method='GET',csrf=s?.csrfToken){return {method,headers:{host:'localhost:47371',origin:'http://localhost:47371',cookie:s?`accounting_session=${s.sessionToken}`:'','x-accounting-csrf':csrf}};}
test('one offline owner, secure hash, seeded accounts and bootstrap cannot repeat',t=>{
 const db=fresh(t);const b=bootstrapLocalOwner({db,businessName:'Acme',password:'long test password 123'});
 assert.ok(b.businessId);assert.ok(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n>15);
 assert.equal(db.prepare('SELECT password_hash FROM local_users').get().password_hash.includes('long test password'),false);
 assert.throws(()=>bootstrapLocalOwner({db,businessName:'Another',password:'long test password 123'}),/already registered/);
});
test('real login session, csrf, expiry and logout revocation',t=>{
 const db=fresh(t);bootstrapLocalOwner({db,businessName:'Acme',password:'long test password 123'});
 assert.throws(()=>loginLocal({db,password:'wrong',now:NOW}),/Invalid credentials/);
 const session=loginLocal({db,password:'long test password 123',now:NOW});
 assert.ok(authenticateRequest({db,req:req(session,'POST'),now:NOW+5}).businessId);
 assert.throws(()=>authenticateRequest({db,req:req(session,'POST','wrong'),now:NOW+5}),/CSRF/);
 assert.throws(()=>authenticateRequest({db,req:req(session,'GET'),now:session.expiresAt}),/expired/);
 assert.ok(revokeLocalSession({db,sessionToken:session.sessionToken,now:NOW+10}));
 assert.throws(()=>authenticateRequest({db,req:req(session),now:NOW+20}),/expired/);
});
