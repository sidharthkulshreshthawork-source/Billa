import test from 'node:test';
import assert from 'node:assert/strict';
import {computeServiceInvoicePreview} from '../../server/accounting/tax.js';
const seller={is_gst_registered:1,seller_state:'08',gstin:'08AAAAA0000A1Z5'};
const input=()=>({invoiceDate:'2026-10-30',documentType:'tax-invoice',customer:{id:'cust-1',name:'Ramesh'},placeOfSupplyState:'08',lines:[{kind:'service',description:'Maintenance',sac:'998314',quantity:'1',rate:'10000.00',gstPercent:'18'}]});
test('same-state INR 10,000 + 18 percent posts 900 CGST, 900 SGST',()=>{
 const {preview,errors}=computeServiceInvoicePreview({seller,input:input()});
 assert.deepEqual(errors,[]);assert.equal(preview.totalReceivablePaise,1180000);
 assert.equal(preview.cgstPaise,90000);assert.equal(preview.sgstPaise,90000);assert.equal(preview.igstPaise,0);
});
test('interstate tax uses IGST, with no duplicated state tax',()=>{
 const data=input();data.placeOfSupplyState='27';
 const {preview}=computeServiceInvoicePreview({seller,input:data});
 assert.equal(preview.igstPaise,180000);assert.equal(preview.cgstPaise,0);assert.equal(preview.totalTaxPaise,180000);
});
test('missing registration, SAC and invalid money cannot become a valid tax invoice',()=>{
 const data=input();data.lines[0].sac='';data.lines[0].rate='100.001';
 const result=computeServiceInvoicePreview({seller:{...seller,gstin:null},input:data});
 assert.equal(result.preview,null);assert.ok(result.errors.length>=3);
});
test('unregistered bill of supply records zero tax',()=>{
 const data=input();data.documentType='bill-of-supply';data.lines[0].gstPercent='0';
 const result=computeServiceInvoicePreview({seller:{is_gst_registered:0,seller_state:'08'},input:data});
 assert.equal(result.errors.length,0);assert.equal(result.preview.totalReceivablePaise,1000000);
});
