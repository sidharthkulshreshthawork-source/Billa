import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAccountingDb} from '../../server/accounting/sqlite.js';
import {bootstrapLocalOwner} from '../../server/accounting/auth.js';
import {prepareServiceInvoice,reviseServiceInvoice,approveDraft,postApprovedInvoice} from '../../server/accounting/invoices.js';
const now=Date.parse('2026-10-30T08:00:00Z');
const sample=()=>({invoiceDate:'2026-10-30',documentType:'tax-invoice',customer:{id:'c-1',name:'Ramesh'},placeOfSupplyState:'08',
 lines:[{kind:'service',description:'Repairs',sac:'998314',quantity:'1',rate:'10000.00',gstPercent:'18'}]});
function dbFor(t){
 const dir=mkdtempSync(join(tmpdir(),'billa-post-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=openAccountingDb({dataDir:dir});t.after(()=>db.close());
 const user=bootstrapLocalOwner({db,businessName:'Billa',password:'strong password for tests'});
 const actor={businessId:user.businessId,ownerId:user.ownerId};
 db.prepare("UPDATE businesses SET seller_state='08',gstin='08AAAAA0000A1Z5',is_gst_registered=1 WHERE id=?").run(actor.businessId);
 return {db,actor};
}
test('posted journal has exact double-entry and cannot be mutated by raw SQL',t=>{
 const {db,actor}=dbFor(t);
 const d=prepareServiceInvoice({db,actor,input:sample()});
 const a=approveDraft({db,actor,draftId:d.draftId,revision:1,digest:d.digest,now});
 const p=postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:d.digest,approvalId:a.approvalId,operationId:'one-post-001',now:now+10});
 assert.equal(p.totalPaise,1180000);
 const entries=db.prepare('SELECT a.account_code AS code,l.debit_paise AS debit,l.credit_paise AS credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id ORDER BY a.account_code').all();
 assert.deepEqual(entries.map(e=>[e.code,e.debit,e.credit]),[['1100',1180000,0],['2100',0,90000],['2110',0,90000],['4000',0,1000000]]);
 assert.throws(()=>db.prepare('DELETE FROM posted_invoices WHERE id=?').run(p.invoiceId),/immutable/);
 assert.throws(()=>db.prepare('UPDATE journal_lines SET debit_paise=999 WHERE entry_id=?').run(p.journalId),/immutable/);
 assert.throws(()=>db.prepare('DELETE FROM journal_entries WHERE id=?').run(p.journalId),/immutable/);
 assert.equal(postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:d.digest,approvalId:a.approvalId,operationId:'one-post-001',now:now+20}).invoiceId,p.invoiceId);
 assert.throws(()=>postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:'wrong',approvalId:a.approvalId,operationId:'one-post-001',now:now+20}),/Operation ID/);
});
test('malformed or stale approval never posts and failed journal write rolls back all money',t=>{
 const {db,actor}=dbFor(t);
 const d=prepareServiceInvoice({db,actor,input:sample()});
 const a=approveDraft({db,actor,draftId:d.draftId,revision:1,digest:d.digest,now});
 assert.throws(()=>postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:d.digest,approvalId:a.approvalId,operationId:'expired-post',now:now+300001}),/expired/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posted_invoices').get().n,0);
 // Deliberately corrupt the chart in a scratch database, simulating failed posting after document insert.
 db.prepare("DELETE FROM accounts WHERE business_id=? AND account_code='2100'").run(actor.businessId);
 assert.throws(()=>postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:d.digest,approvalId:a.approvalId,operationId:'broken-post',now:now+1}),/account/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posted_invoices').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM idempotency_records').get().n,0);
 assert.equal(db.prepare('SELECT consumed_at FROM approvals WHERE id=?').get(a.approvalId).consumed_at,null);
});
test('draft revision or business tax changes invalidate old approvals',t=>{
 const {db,actor}=dbFor(t);
 const d=prepareServiceInvoice({db,actor,input:sample()});
 const a=approveDraft({db,actor,draftId:d.draftId,revision:1,digest:d.digest,now});
 const input=sample();input.lines[0].rate='11000.00';
 const revised=reviseServiceInvoice({db,actor,draftId:d.draftId,revision:1,input});
 assert.equal(revised.revision,2);
 assert.throws(()=>postApprovedInvoice({db,actor,draftId:d.draftId,revision:1,digest:d.digest,approvalId:a.approvalId,operationId:'stale-post',now:now+2}),/changed|stale/i);
 const approval=approveDraft({db,actor,draftId:d.draftId,revision:2,digest:revised.digest,now});
 db.prepare("UPDATE businesses SET seller_state='27',gstin='27AAAAA0000A1Z5' WHERE id=?").run(actor.businessId);
 assert.throws(()=>postApprovedInvoice({db,actor,draftId:d.draftId,revision:2,digest:revised.digest,approvalId:approval.approvalId,operationId:'change-post',now:now+2}),/changed|preview/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posted_invoices').get().n,0);
});
