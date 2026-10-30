import {createHash,randomUUID} from 'node:crypto';
import {transaction} from './sqlite.js';
import {computeServiceInvoicePreview} from './tax.js';

function fail(code,message,status=409){const e=new Error(message);e.code=code;e.status=status;throw e;}
function verifyActor(actor){if(!actor?.businessId||!actor?.ownerId)fail('UNAUTHORIZED','Business owner session required',401);}
function seller(db,actor){
  const row=db.prepare('SELECT id,seller_state,gstin,is_gst_registered FROM businesses WHERE id=?').get(actor.businessId);
  if(!row)fail('BUSINESS_NOT_FOUND','Business not found',404);
  return row;
}
function makeSnapshot(db,actor,input,revision){
  const owner=seller(db,actor);
  const {preview,errors}=computeServiceInvoicePreview({seller:owner,input});
  const digest=createHash('sha256').update(JSON.stringify({businessId:actor.businessId,ownerId:actor.ownerId,revision,owner,input,preview,errors})).digest('hex');
  return {revision,digest,preview,errors};
}
function readDraft(db,actor,id){
  verifyActor(actor);
  const row=db.prepare('SELECT * FROM invoice_drafts WHERE id=? AND business_id=? AND owner_id=?')
    .get(id,actor.businessId,actor.ownerId);
  if(!row)fail('DRAFT_NOT_FOUND','Draft not found',404);
  const saved=JSON.parse(row.preview_json);
  return {draftId:row.id,revision:row.revision,digest:row.digest,input:JSON.parse(row.input_json),preview:saved.preview,errors:saved.errors};
}
export function getServiceInvoiceDraft({db,actor,draftId}){return readDraft(db,actor,draftId);}
export function listServiceInvoiceDrafts({db,actor}){
  verifyActor(actor);
  return db.prepare(`SELECT d.id AS draftId,d.revision,d.updated_at AS updatedAt,
    d.input_json AS inputJson,d.preview_json AS previewJson,d.digest
    FROM invoice_drafts d WHERE d.business_id=? AND d.owner_id=?
    AND NOT EXISTS(SELECT 1 FROM posted_invoices p WHERE p.draft_id=d.id)
    ORDER BY d.updated_at DESC LIMIT 100`).all(actor.businessId,actor.ownerId).map(r=>({
    draftId:r.draftId,revision:r.revision,digest:r.digest,updatedAt:r.updatedAt,
    input:JSON.parse(r.inputJson),...JSON.parse(r.previewJson)
  }));
}
export function prepareServiceInvoice({db,actor,input}){
  verifyActor(actor);
  const data=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const snapshot=makeSnapshot(db,actor,data,1);
  const draftId=randomUUID(),timestamp=new Date().toISOString();
  db.prepare(`INSERT INTO invoice_drafts(id,business_id,owner_id,revision,input_json,preview_json,digest,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(draftId,actor.businessId,actor.ownerId,1,JSON.stringify(data),JSON.stringify({preview:snapshot.preview,errors:snapshot.errors}),snapshot.digest,timestamp,timestamp);
  return {draftId,...snapshot};
}
export function reviseServiceInvoice({db,actor,draftId,revision,input}){
  verifyActor(actor);
  return transaction(db,()=>{
    const previous=readDraft(db,actor,draftId);
    if(db.prepare('SELECT id FROM posted_invoices WHERE business_id=? AND draft_id=?').get(actor.businessId,draftId))
      fail('ALREADY_POSTED','Posted invoices cannot be edited');
    if(previous.revision!==revision)fail('STALE_REVISION','Draft was edited elsewhere. Reload and review again');
    const data=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
    const snapshot=makeSnapshot(db,actor,data,revision+1);
    db.prepare('UPDATE invoice_drafts SET revision=?,input_json=?,preview_json=?,digest=?,updated_at=? WHERE id=? AND business_id=?')
      .run(snapshot.revision,JSON.stringify(data),JSON.stringify({preview:snapshot.preview,errors:snapshot.errors}),snapshot.digest,new Date().toISOString(),draftId,actor.businessId);
    db.prepare('UPDATE approvals SET revoked_at=? WHERE draft_id=? AND consumed_at IS NULL AND revoked_at IS NULL')
      .run(Date.now(),draftId);
    return {draftId,...snapshot};
  });
}
function verifiedPreview(db,actor,draft){
  const fresh=makeSnapshot(db,actor,draft.input,draft.revision);
  if(fresh.digest!==draft.digest||fresh.errors.length||!fresh.preview)
    fail('PREVIEW_CHANGED','Seller settings or invoice details have changed. Save and review again');
  return fresh.preview;
}
export function approveDraft({db,actor,draftId,revision,digest,now=Date.now()}){
  verifyActor(actor);
  return transaction(db,()=>{
    const draft=readDraft(db,actor,draftId);
    if(draft.revision!==revision||draft.digest!==digest)fail('STALE_APPROVAL','Draft has changed. Review before approval');
    if(db.prepare('SELECT 1 FROM posted_invoices WHERE business_id=? AND draft_id=?').get(actor.businessId,draftId))
      fail('ALREADY_POSTED','Invoice already posted');
    verifiedPreview(db,actor,draft);
    db.prepare('UPDATE approvals SET revoked_at=? WHERE draft_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(now,draftId);
    const approvalId=randomUUID(),expiresAt=now+300000;
    db.prepare('INSERT INTO approvals(id,business_id,actor_id,draft_id,revision,digest,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(approvalId,actor.businessId,actor.ownerId,draftId,revision,digest,now,expiresAt);
    return {approvalId,expiresAt};
  });
}
function financialYear(date){const year=Number(date.slice(0,4));const start=Number(date.slice(5,7))>=4?year:year-1;return `${start}-${String((start+1)%100).padStart(2,'0')}`;}
function nextInvoiceNumber(db,businessId,fy,type){
  // SQLite BEGIN IMMEDIATE serializes writers; posted invoices are immutable.
  const count=db.prepare('SELECT COUNT(*) AS n FROM posted_invoices WHERE business_id=? AND financial_year=? AND document_type=?')
    .get(businessId,fy,type).n+1;
  if(count>99999)fail('SEQUENCE_EXHAUSTED','Invoice number range exhausted');
  return `${type==='bill-of-supply'?'BOS':'INV'}/${fy.slice(2,4)}-${fy.slice(-2)}/${String(count).padStart(5,'0')}`;
}
function requestHash(actor,req){
  return createHash('sha256').update(JSON.stringify({businessId:actor.businessId,ownerId:actor.ownerId,
    draftId:req.draftId,revision:req.revision,digest:req.digest,approvalId:req.approvalId})).digest('hex');
}

/** A single SQLite transaction contains the posted document, journal, approval, audit and replay record. */
export function postApprovedInvoice({db,actor,draftId,revision,digest,approvalId,operationId,now=Date.now()}){
  verifyActor(actor);
  if(typeof operationId!=='string'||!/^[-a-zA-Z0-9_]{3,128}$/.test(operationId))
    fail('INVALID_OPERATION_ID','A unique operation ID is required',400);
  if(typeof approvalId!=='string'||!approvalId)fail('APPROVAL_REQUIRED','Confirm exact invoice in the application');
  const signature=requestHash(actor,{draftId,revision,digest,approvalId});
  return transaction(db,()=>{
    const previous=db.prepare('SELECT request_digest,response_json FROM idempotency_records WHERE business_id=? AND operation_id=?')
      .get(actor.businessId,operationId);
    if(previous){
      if(previous.request_digest!==signature)fail('IDEMPOTENCY_CONFLICT','Operation ID already used for different details');
      return JSON.parse(previous.response_json);
    }
    const draft=readDraft(db,actor,draftId);
    if(draft.revision!==revision||draft.digest!==digest)fail('STALE_APPROVAL','Draft was changed, review again');
    if(db.prepare('SELECT id FROM posted_invoices WHERE business_id=? AND draft_id=?').get(actor.businessId,draftId))
      fail('ALREADY_POSTED','Invoice already posted');
    const preview=verifiedPreview(db,actor,draft);
    const approval=db.prepare('SELECT * FROM approvals WHERE id=? AND business_id=? AND actor_id=? AND draft_id=?')
      .get(approvalId,actor.businessId,actor.ownerId,draftId);
    if(!approval)fail('APPROVAL_DENIED','Approval is not valid for this owner or business');
    if(approval.revision!==revision||approval.digest!==digest)fail('STALE_APPROVAL','Approval no longer matches the draft');
    if(approval.revoked_at!==null)fail('APPROVAL_REVOKED','Invoice approval was revoked');
    if(approval.consumed_at!==null)fail('APPROVAL_USED','Approval was already used');
    if(now>=approval.expires_at)fail('APPROVAL_EXPIRED','Five-minute confirmation expired. Review again');

    const fy=financialYear(preview.invoiceDate);
    const invoiceId=randomUUID(),journalId=randomUUID(),invoiceNumber=nextInvoiceNumber(db,actor.businessId,fy,preview.documentType);
    const postedAt=new Date(now).toISOString();
    db.prepare(`INSERT INTO posted_invoices
      (id,business_id,draft_id,financial_year,document_type,invoice_number,invoice_date,customer_id,customer_name,currency,taxable_paise,cgst_paise,sgst_paise,igst_paise,utgst_paise,cess_paise,total_paise,payload_json,posted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      invoiceId,actor.businessId,draftId,fy,preview.documentType,invoiceNumber,preview.invoiceDate,
      preview.customerId,preview.customerName,'INR',preview.taxablePaise,preview.cgstPaise,preview.sgstPaise,
      preview.igstPaise,preview.utgstPaise,preview.cessPaise,preview.totalReceivablePaise,
      JSON.stringify({input:draft.input,preview}),postedAt
    );
    db.prepare('INSERT INTO journal_entries(id,business_id,source_type,source_id,entry_date,created_at,finalized) VALUES(?,?,?,?,?,?,0)')
      .run(journalId,actor.businessId,'service-invoice',invoiceId,preview.invoiceDate,postedAt);
    const lines=[['1100',preview.totalReceivablePaise,0],['4000',0,preview.taxablePaise]];
    for(const [account,amount] of [['2100',preview.cgstPaise],['2110',preview.sgstPaise],['2120',preview.igstPaise],['2130',preview.utgstPaise],['2140',preview.cessPaise]])
      if(amount>0)lines.push([account,0,amount]);
    const totalDebit=lines.reduce((n,x)=>n+BigInt(x[1]),0n);
    const totalCredit=lines.reduce((n,x)=>n+BigInt(x[2]),0n);
    if(totalDebit<=0n||totalDebit!==totalCredit)fail('UNBALANCED_ENTRY','Ledger does not balance');
    const account=db.prepare('SELECT id FROM accounts WHERE business_id=? AND account_code=?');
    const insertLine=db.prepare('INSERT INTO journal_lines(entry_id,business_id,line_no,account_id,debit_paise,credit_paise) VALUES(?,?,?,?,?,?)');
    lines.forEach(([code,debit,credit],index)=>{
      if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||((debit>0)===(credit>0)))
        fail('UNBALANCED_ENTRY','Invalid debit/credit line');
      const record=account.get(actor.businessId,code);
      if(!record)fail('MISSING_ACCOUNT',`Standard account ${code} not available`);
      insertLine.run(journalId,actor.businessId,index+1,record.id,debit,credit);
    });
    db.prepare('UPDATE journal_entries SET finalized=1 WHERE id=? AND business_id=?').run(journalId,actor.businessId);
    db.prepare('UPDATE approvals SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(now,approvalId);
    const result={invoiceId,invoiceNumber,journalId,totalPaise:preview.totalReceivablePaise};
    db.prepare('INSERT INTO idempotency_records(business_id,operation_id,request_digest,response_json,created_at) VALUES(?,?,?,?,?)')
      .run(actor.businessId,operationId,signature,JSON.stringify(result),postedAt);
    db.prepare('INSERT INTO audit_events(id,business_id,actor_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),actor.businessId,actor.ownerId,'invoice.posted',JSON.stringify({invoiceId,invoiceNumber,journalId,approvalId,operationId}),postedAt);
    return result;
  });
}
