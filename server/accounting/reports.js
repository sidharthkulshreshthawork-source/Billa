function validDate(value,label){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||
   new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new RangeError(`Invalid ${label} date`);
 return value;
}
function bounds(from,to){const start=validDate(from,'start'),end=validDate(to,'end');if(start&&end&&start>end)throw new RangeError('Invalid date range');return [start,end];}
function business(id){if(typeof id!=='string'||!id.trim())throw new TypeError('Authenticated business required');}
function paise(n){const value=Number(n??0);if(!Number.isSafeInteger(value))throw new RangeError('Ledger amount exceeds safe paise range');return value;}

/** Only posted journals are counted. Debit minus credit is the signed balance. */
export function getTrialBalance({db,businessId,from=null,to=null}){
 business(businessId);const [start,end]=bounds(from,to);
 const rows=db.prepare(`SELECT a.account_code AS code,a.name,a.kind,a.normal_balance AS normalBalance,
   SUM(l.debit_paise) AS debitPaise,SUM(l.credit_paise) AS creditPaise
   FROM journal_lines l JOIN journal_entries j ON j.id=l.entry_id AND j.business_id=l.business_id
   JOIN accounts a ON a.id=l.account_id AND a.business_id=l.business_id
   WHERE j.business_id=? AND j.finalized=1 AND (? IS NULL OR j.entry_date>=?) AND (? IS NULL OR j.entry_date<=?)
   GROUP BY a.account_code,a.name,a.kind,a.normal_balance ORDER BY a.account_code`).all(businessId,start,start,end,end);
 const accounts=rows.map(r=>({...r,debitPaise:paise(r.debitPaise),creditPaise:paise(r.creditPaise),
   balancePaise:paise(BigInt(r.debitPaise)-BigInt(r.creditPaise))}));
 const debit=paise(accounts.reduce((n,x)=>n+BigInt(x.debitPaise),0n));
 const credit=paise(accounts.reduce((n,x)=>n+BigInt(x.creditPaise),0n));
 return {from:start,to:end,accounts,totalDebitPaise:debit,totalCreditPaise:credit,balanced:debit===credit,openingBalancesComplete:false};
}
export function getJournal({db,businessId,from=null,to=null}){
 business(businessId);const [start,end]=bounds(from,to);
 const rows=db.prepare(`SELECT j.id AS journalId,j.source_id AS sourceInvoiceId,j.entry_date AS entryDate,j.created_at AS postedAt,
   p.invoice_number AS invoiceNumber,p.customer_name AS customerName FROM journal_entries j
   LEFT JOIN posted_invoices p ON p.id=j.source_id AND p.business_id=j.business_id
   WHERE j.business_id=? AND j.finalized=1 AND (? IS NULL OR j.entry_date>=?) AND (? IS NULL OR j.entry_date<=?)
   ORDER BY j.entry_date DESC,j.created_at DESC`).all(businessId,start,start,end,end);
 const statement=db.prepare(`SELECT a.account_code AS code,a.name,l.debit_paise AS debitPaise,l.credit_paise AS creditPaise
   FROM journal_lines l JOIN accounts a ON a.id=l.account_id AND a.business_id=l.business_id
   WHERE l.entry_id=? AND l.business_id=? ORDER BY l.line_no`);
 return {from:start,to:end,entries:rows.map(row=>({...row,lines:statement.all(row.journalId,businessId).map(x=>({
   ...x,debitPaise:paise(x.debitPaise),creditPaise:paise(x.creditPaise)
 }))}))};
}
export function getServiceRevenueSummary({db,businessId,from=null,to=null}){
 business(businessId);const [start,end]=bounds(from,to);
 const totals=db.prepare(`SELECT a.account_code AS code,COALESCE(SUM(l.credit_paise-l.debit_paise),0) AS netPaise
   FROM journal_lines l JOIN accounts a ON a.id=l.account_id AND a.business_id=l.business_id
   JOIN journal_entries j ON j.id=l.entry_id AND j.business_id=l.business_id
   WHERE j.business_id=? AND j.finalized=1 AND j.source_type='service-invoice'
   AND a.account_code IN ('4000','2100','2110','2120','2130','2140')
   AND (? IS NULL OR j.entry_date>=?) AND (? IS NULL OR j.entry_date<=?)
   GROUP BY a.account_code`).all(businessId,start,start,end,end);
 const map=Object.fromEntries(totals.map(x=>[x.code,paise(x.netPaise)]));
 const revenuePaise=paise(map['4000']||0);
 const gstOutputPaise=paise(['2100','2110','2120','2130','2140'].reduce((n,code)=>n+BigInt(map[code]||0),0n));
 const invoiceCount=db.prepare(`SELECT COUNT(*) AS n FROM posted_invoices WHERE business_id=?
   AND (? IS NULL OR invoice_date>=?) AND (? IS NULL OR invoice_date<=?)`).get(businessId,start,start,end,end).n;
 return {from:start,to:end,revenuePaise,gstOutputPaise,invoiceCount,profitShown:false};
}
export function getOpenReceivables({db,businessId,asOf=null}){
 business(businessId);const end=validDate(asOf,'as-of');
 const rows=db.prepare(`SELECT p.id AS invoiceId,p.invoice_number AS invoiceNumber,p.invoice_date AS invoiceDate,
   p.customer_id AS customerId,p.customer_name AS customerName,SUM(l.debit_paise-l.credit_paise) AS amountDuePaise
   FROM posted_invoices p JOIN journal_entries j ON j.source_id=p.id AND j.business_id=p.business_id AND j.source_type='service-invoice' AND j.finalized=1
   JOIN journal_lines l ON l.entry_id=j.id AND l.business_id=j.business_id
   JOIN accounts a ON a.id=l.account_id AND a.business_id=l.business_id AND a.account_code='1100'
   WHERE p.business_id=? AND (? IS NULL OR p.invoice_date<=?)
   GROUP BY p.id,p.invoice_number,p.invoice_date,p.customer_id,p.customer_name ORDER BY p.invoice_date DESC,p.invoice_number DESC`).all(businessId,end,end);
 const invoices=rows.map(row=>({...row,amountDuePaise:paise(row.amountDuePaise)}));
 const totalOpenPaise=paise(invoices.reduce((n,x)=>n+BigInt(x.amountDuePaise),0n));
 return {asOf:end,invoices,totalOpenPaise,receiptsSupported:false,openingBalancesComplete:false};
}
