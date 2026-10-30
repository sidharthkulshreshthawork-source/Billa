import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const urlFor = async child => new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Billa server did not start')),25000);
  let output='';
  child.stdout.on('data',data=>{
    output+=String(data);
    const match=output.match(/http:\/\/localhost:(\d+)/);
    if(match){clearTimeout(timeout);resolve(match[0]);}
  });
  child.on('exit',code=>{clearTimeout(timeout);reject(Error(`Billa server exited: ${code}; ${output}`));});
});
const sample=()=>({
  invoiceDate:'2026-10-30',documentType:'tax-invoice',customer:{id:'ramesh-01',name:'Ramesh'},
  placeOfSupplyState:'08',lines:[{kind:'service',description:'Maintenance',sac:'998314',quantity:'1',rate:'10000.00',gstPercent:'18'}]
});
const scratch=mkdtempSync(join(tmpdir(),'billa-e2e-'));
const start=()=>spawn(process.execPath,['server.js'],{
  cwd:process.cwd(),env:{...process.env,ACCOUNTING_MODE:'1',ACCOUNTING_DATA_DIR:scratch},
  stdio:['ignore','pipe','pipe']
});
async function stop(child){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{child.kill('SIGKILL');resolve();},2500).unref();});
}

test('real Express service invoice: owner, draft, exact confirmation, balanced ledger, restart and legacy guard',async()=>{
  let server=start();
  try{
    let base=await urlFor(server);
    let cookie='',csrf='';
    async function request(path,{method='GET',body,authenticated=true}={}){
      const headers={Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'})};
      if(authenticated&&cookie)headers.Cookie=cookie;
      if(authenticated&&csrf)headers['X-Accounting-CSRF']=csrf;
      const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
      let data;try{data=await response.json();}catch{data=null;}
      return {status:response.status,body:data,headers:response.headers};
    }
    const status=await request('/api/v2/auth/status');
    assert.equal(status.status,200);assert.equal(status.body.initialized,false);

    const account=await request('/api/v2/auth/bootstrap',{method:'POST',body:{businessName:'Test Services',password:'long test passphrase 123'}});
    assert.equal(account.status,201);
    const denied=await request('/api/v2/accounting/trial-balance');
    assert.equal(denied.status,401);
    const login=await request('/api/v2/auth/login',{method:'POST',body:{password:'long test passphrase 123'}});
    assert.equal(login.status,200);
    cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrfToken;
    const identity=await request('/api/v2/auth/me');
    assert.equal(identity.status,200);assert.equal(identity.body.business.name,'Test Services');

    const badCsrf=csrf;csrf='';
    assert.equal((await request('/api/v2/invoices/drafts',{method:'POST',body:sample()})).status,403);
    csrf=badCsrf;
    const legacy=await request('/api/bills',{method:'POST',body:{id:'should-never-write'}});
    assert.equal(legacy.status,409);assert.equal(legacy.body.code,'ACCOUNTING_MIGRATION_REQUIRED');
    const legacyGet=await request('/api/bills');
    assert.equal(legacyGet.status,409);

    const config=await request('/api/v2/business/tax-config',{method:'PUT',body:{sellerState:'08',gstin:'08AAAAA0000A1Z5',registered:true}});
    assert.equal(config.status,200);
    const incomplete=sample();incomplete.lines[0].rate='bad';
    const draftBad=await request('/api/v2/invoices/drafts',{method:'POST',body:incomplete});
    assert.equal(draftBad.status,201);assert.ok(draftBad.body.errors.length);
    const denyBad=await request(`/api/v2/invoices/drafts/${draftBad.body.draftId}/approve`,{method:'POST',body:{revision:1,digest:draftBad.body.digest}});
    assert.equal(denyBad.status,409);

    const draft=await request('/api/v2/invoices/drafts',{method:'POST',body:sample()});
    assert.equal(draft.status,201);assert.equal(draft.body.preview.totalReceivablePaise,1180000);
    assert.equal(draft.body.preview.cgstPaise,90000);assert.equal(draft.body.preview.sgstPaise,90000);
    assert.equal((await request('/api/v2/accounting/trial-balance')).body.totalDebitPaise,0);
    const approval=await request(`/api/v2/invoices/drafts/${draft.body.draftId}/approve`,{method:'POST',body:{revision:draft.body.revision,digest:draft.body.digest}});
    assert.equal(approval.status,200);
    const payload={revision:1,digest:draft.body.digest,approvalId:approval.body.approvalId,operationId:'e2e-post-001'};
    const posted=await request(`/api/v2/invoices/drafts/${draft.body.draftId}/post`,{method:'POST',body:payload});
    assert.equal(posted.status,201);assert.equal(posted.body.totalPaise,1180000);
    const retry=await request(`/api/v2/invoices/drafts/${draft.body.draftId}/post`,{method:'POST',body:payload});
    assert.deepEqual(retry.body,posted.body);
    const reuse=await request(`/api/v2/invoices/drafts/${draft.body.draftId}/post`,{method:'POST',body:{...payload,digest:'forged'}});
    assert.equal(reuse.status,409);
    const invoice=await request('/api/v2/invoices/'+posted.body.invoiceId);
    assert.equal(invoice.body.customer_name,'Ramesh');
    const trial=await request('/api/v2/accounting/trial-balance');
    assert.equal(trial.status,200);assert.equal(trial.body.balanced,true);
    assert.equal(trial.body.totalDebitPaise,1180000);assert.equal(trial.body.totalCreditPaise,1180000);
    const revenue=await request('/api/v2/accounting/service-revenue');
    assert.equal(revenue.body.revenuePaise,1000000);assert.equal(revenue.body.gstOutputPaise,180000);
    const ar=await request('/api/v2/accounting/receivables');
    assert.equal(ar.body.totalOpenPaise,1180000);
    assert.equal(ar.body.invoices.length,1);
    const listed=await request('/api/v2/invoices');
    assert.equal(listed.body.invoices.length,1);

    // An approval tied to an old revision can never post after draft edits.
    const other=await request('/api/v2/invoices/drafts',{method:'POST',body:sample()});
    const oldApproval=await request(`/api/v2/invoices/drafts/${other.body.draftId}/approve`,{method:'POST',body:{revision:1,digest:other.body.digest}});
    const changed=sample();changed.lines[0].rate='12000.00';
    const revised=await request(`/api/v2/invoices/drafts/${other.body.draftId}`,{method:'PUT',body:{revision:1,input:changed}});
    assert.equal(revised.body.revision,2);
    const stale=await request(`/api/v2/invoices/drafts/${other.body.draftId}/post`,{method:'POST',body:{revision:1,digest:other.body.digest,approvalId:oldApproval.body.approvalId,operationId:'e2e-stale-002'}});
    assert.equal(stale.status,409);

    await stop(server);server=start();base=await urlFor(server);
    const after=await request('/api/v2/accounting/trial-balance');
    assert.equal(after.body.totalDebitPaise,1180000);
    assert.equal(after.body.balanced,true);
    assert.equal((await request('/api/v2/invoices')).body.invoices.length,1);
    const logout=await request('/api/v2/auth/logout',{method:'POST',body:{}});
    assert.equal(logout.status,200);
    assert.equal((await request('/api/v2/accounting/journal')).status,401);
  }finally{await stop(server);rmSync(scratch,{recursive:true,force:true});}
});
