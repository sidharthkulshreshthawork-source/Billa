import { toPaise } from './money.js';

const halfUp = (num,den) => (num+den/2n)/den;
function milliQty(value){
  if(typeof value!=='string' && typeof value!=='number')throw Error('Quantity is required');
  const text=String(value);
  if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(text))throw Error('Invalid quantity');
  const [whole,fraction='']=text.split('.');
  const n=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')||'0');
  if(n<=0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Quantity out of range');
  return n;
}
function safe(n){if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Monetary overflow');return Number(n);}
function isoDate(date){
  if(typeof date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return false;
  const d=new Date(date+'T00:00:00Z');
  return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===date;
}

/** A deliberately limited, deterministic service-only GST adapter. Never guesses tax rates. */
export function computeServiceInvoicePreview({seller,input}){
  const errors=[];
  const v=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const business=seller&&typeof seller==='object'?seller:{};
  const customer=v.customer||{};
  if(!isoDate(v.invoiceDate))errors.push('Valid invoice date (YYYY-MM-DD) required');
  if(!['tax-invoice','bill-of-supply'].includes(v.documentType))errors.push('Choose tax-invoice or bill-of-supply');
  if(v.currency && v.currency!=='INR')errors.push('Only INR is supported in accounting mode');
  if(v.taxInclusive||v.reverseCharge||v.sez||v.export||v.discount||v.cess)errors.push('This special GST/discount/stock case is not yet supported by the ledger');
  if(typeof customer.id!=='string'||!customer.id.trim()||typeof customer.name!=='string'||!customer.name.trim())errors.push('Customer ID and name required');
  if(!/^[0-9]{2}$/.test(String(business.seller_state||'')))errors.push('Valid two-digit seller state required');
  if(!/^[0-9]{2}$/.test(String(v.placeOfSupplyState||'')))errors.push('Valid two-digit place of supply required');
  const registered=business.is_gst_registered===1||business.is_gst_registered===true;
  if(v.documentType==='tax-invoice'){
    if(!registered)errors.push('GST tax invoice requires registered business');
    if(typeof business.gstin!=='string'||!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(business.gstin)||!business.gstin.startsWith(String(business.seller_state)))errors.push('Valid seller GSTIN matching seller state required');
  }else if(v.documentType==='bill-of-supply'&&registered)errors.push('Registered business bill-of-supply rules require separate validation');
  if(!Array.isArray(v.lines)||v.lines.length<1||v.lines.length>100)errors.push('Add between 1 and 100 service lines');

  const lines=[];
  for(const [i,item] of (Array.isArray(v.lines)?v.lines:[]).entries()){
    const prefix=`Line ${i+1}`;
    if(!item||item.kind!=='service'){errors.push(`${prefix}: stock items are not supported; choose a service`);continue;}
    if(typeof item.description!=='string'||!item.description.trim())errors.push(`${prefix}: description required`);
    if(typeof item.sac!=='string'||!/^99\d{4}$/.test(item.sac))errors.push(`${prefix}: six-digit service SAC required`);
    let qty=0n,rate=0n,percentage=0n;
    try{qty=milliQty(item.quantity);}catch{errors.push(`${prefix}: enter valid positive quantity with <=3 decimal places`);}
    try{rate=BigInt(toPaise(item.rate));if(rate===0n)throw Error();}catch{errors.push(`${prefix}: enter positive unit rate with <=2 decimal places`);}
    if(v.documentType==='tax-invoice'){
      if(item.gstPercent===null||item.gstPercent===undefined||item.gstPercent==='')errors.push(`${prefix}: explicit GST rate required`);
      else try{percentage=BigInt(toPaise(item.gstPercent));if(percentage<=0n||percentage>10000n)throw Error();}catch{errors.push(`${prefix}: valid GST rate required`);}
    }else if(item.gstPercent!==undefined&&String(item.gstPercent)!=='0')errors.push(`${prefix}: bill of supply cannot charge GST`);
    const taxable=halfUp(qty*rate,1000n),tax=halfUp(taxable*percentage,10000n);
    try{lines.push({description:item.description.trim(),sac:item.sac,quantityMilliUnits:safe(qty),unitRatePaise:safe(rate),taxablePaise:safe(taxable),gstRateBasisPoints:safe(percentage),taxPaise:safe(tax)});}
    catch{errors.push(`${prefix}: amount exceeds ledger limit`);}
  }
  if(errors.length)return {preview:null,errors};
  try{
    const interstate=String(business.seller_state)!==String(v.placeOfSupplyState);
    // Intra-territory tax must distinguish UTGST from SGST.
    // Territories with legislatures (Delhi, Puducherry, J&K) use SGST.
    const isUtgst=['04','26','31','35','38'].includes(String(business.seller_state));
    let cgst=0n,sgst=0n,utgst=0n,igst=0n;
    for(const line of lines){
      const tax=BigInt(line.taxPaise);
      if(interstate)igst+=tax;
      else {
        const part=halfUp(tax,2n);
        cgst+=part;
        if(isUtgst)utgst+=tax-part;
        else sgst+=tax-part;
      }
    }
    const taxable=lines.reduce((n,line)=>n+BigInt(line.taxablePaise),0n);
    const totalTax=cgst+sgst+utgst+igst,total=taxable+totalTax;
    if(total<=0n)throw Error('Invoice cannot be zero');
    return {preview:{
      invoiceDate:v.invoiceDate,documentType:v.documentType,currency:'INR',customerId:customer.id.trim(),
      customerName:customer.name.trim(),placeOfSupplyState:v.placeOfSupplyState,
      sellerState:business.seller_state,sellerGstin:business.gstin||null,lines,
      taxablePaise:safe(taxable),cgstPaise:safe(cgst),sgstPaise:safe(sgst),igstPaise:safe(igst),
      utgstPaise:safe(utgst),cessPaise:0,totalTaxPaise:safe(totalTax),totalReceivablePaise:safe(total)
    },errors:[]};
  }catch(e){return {preview:null,errors:[`Ledger limit: ${e.message}`]};}
}
