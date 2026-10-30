import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

function startServer(dir){
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,ACCOUNTING_MODE:'1',ACCOUNTING_DATA_DIR:dir,BILLA_LEGACY_DATA_DIR:join(dir,'legacy-data')},stdio:['ignore','pipe','pipe']});
  const url=new Promise((resolve,reject)=>{
    let buffer='';const timer=setTimeout(()=>reject(Error('Billa accounting app failed to start')),25000);
    child.stdout.on('data',chunk=>{buffer+=String(chunk);const m=buffer.match(/http:\/\/localhost:\d+/);
      if(m){clearTimeout(timer);resolve(m[0]);}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Billa server exited '+code+' '+buffer));});
  });
  return {child,url};
}
async function terminate(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{const timer=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
}
test('browser signup, GST setup, draft, deliberate posting, printed invoice and ledger',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'billa-browser-'));
  const server=startServer(dir);
  let browser;
  try{
    const url=await server.url;
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const context=await browser.newContext();
    const page=await context.newPage();
    await page.goto(url,{waitUntil:'domcontentloaded'});
    // Default startup MUST be the original Billa (not the Beta login).
    const originalNav=page.locator('.sidebar-nav');
    await originalNav.getByRole('button',{name:'Dashboard',exact:true}).waitFor();
    // Original module preferences may hide optional menus until setup is
    // complete; that is legacy behavior, not a Beta regression. Check the
    // underlying endpoints and always-available original navigation.
    assert.equal(await originalNav.getByRole('button',{name:'New Invoice',exact:true}).count(),1);
    assert.equal(await originalNav.getByRole('button',{name:'Settings',exact:true}).count(),1);
    const legacyEndpoints=await page.evaluate(async()=>Promise.all(
      ['/api/products','/api/clients','/api/purchases'].map(route=>fetch(route).then(r=>r.status))
    ));
    assert.deepEqual(legacyEndpoints,[200,200,200]);
    // Clear the original app's welcome wizard if a fresh test profile shows it.
    for(let i=0;i<5;i++){
      const skip=page.getByRole('button',{name:/^skip setup$/i}).first();
      if(await skip.isVisible().catch(()=>false)){await skip.click();continue;}
      const other=page.getByRole('button',{name:/none of these|continue|finish|close/i}).first();
      if(await other.isVisible().catch(()=>false)){await other.click();continue;}
      break;
    }
    const betaEntry=originalNav.getByRole('button',{name:'Accounting (Beta)'});
    await betaEntry.waitFor({state:'visible'});
    assert.equal(await page.getByRole('heading',{name:'Create your business'}).count(),0);
    await betaEntry.click();
    await page.getByRole('heading',{name:'Create your business'}).waitFor();
    await page.getByLabel('Business name').fill('Billa Test Services');
    await page.getByLabel('Owner password (12+ characters)').fill('strong offline password 123');
    await page.getByLabel('Confirm password').fill('strong offline password 123');
    await page.getByRole('button',{name:'Create local business'}).click();
    await page.getByRole('heading',{name:'Create service invoice'}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'GST settings'}).click();
    await page.getByLabel('Seller state').selectOption('08');
    await page.getByLabel('Registered under GST').check();
    await page.getByLabel('GSTIN').fill('08AAAAA0000A1Z5');
    await page.getByRole('button',{name:'Save GST settings'}).click();
    await page.getByText('Business tax settings saved.').first().waitFor();
    await page.locator('.billa-nav').getByRole('button',{name:'New invoice'}).click();
    await page.getByLabel('Customer name').fill('Ramesh');
    await page.getByLabel('Place of supply').selectOption('08');
    await page.getByLabel('Service description').fill('Maintenance');
    await page.getByLabel('SAC (6 digits)').fill('998314');
    await page.getByLabel('Unit rate (₹)').fill('10000.00');
    await page.getByLabel('GST rate').selectOption('18');
    await page.getByRole('button',{name:'Save draft & calculate'}).click();
    await page.getByText('Draft saved. Review').waitFor();
    await page.getByText(/₹11,800/).first().waitFor();
    await page.getByRole('button',{name:'Review & post invoice'}).click();
    await page.getByRole('dialog',{name:'Confirm invoice posting'}).getByRole('button',{name:'Confirm and post'}).click();
    await page.getByText(/posted with balanced accounts/).waitFor();
    await page.getByRole('button',{name:'Accounts'}).click();
    await page.getByRole('heading',{name:/Trial balance/}).waitFor();
    await page.getByText(/₹10,000/).first().waitFor();
    assert.ok((await page.locator('.billa-table').allTextContents()).join(' ').includes('Trade Receivables'));
    await page.getByRole('button',{name:'Posted invoices'}).click();
    await page.getByRole('button',{name:'View / print'}).click();
    await page.getByRole('button',{name:'Print invoice'}).waitFor();
    await page.getByText('ACCOUNTING RECORD — NOT A STATUTORY GST TAX INVOICE').waitFor();
    await page.emulateMedia({media:'print'});
    assert.equal(await page.getByText('ACCOUNTING RECORD — NOT A STATUTORY GST TAX INVOICE').isVisible(),true,'warning must appear on printed copy');
    await page.emulateMedia({media:'screen'});
    // Going back to the original app must restore its products/invoices UI.
    await originalNav.getByRole('button',{name:'Settings',exact:true}).click();
    assert.match(await originalNav.getByRole('button',{name:'Settings',exact:true}).getAttribute('class'),/nav-btn-active/);
    assert.equal((await page.evaluate(async()=>fetch('/api/bills').then(r=>r.status))),200);
    await originalNav.getByRole('button',{name:'Accounting (Beta)'}).click();
    await page.getByRole('heading',{name:'Create service invoice'}).waitFor();
    // Reloading always starts on original Billa, even if Beta was last viewed.
    await page.reload();
    await page.locator('.sidebar-nav').getByRole('button',{name:'Dashboard',exact:true}).waitFor();
    assert.equal(await page.locator('.billa-workspace').count(),0);
    await page.locator('.sidebar-nav').getByRole('button',{name:'Accounting (Beta)'}).click();
    await page.getByRole('heading',{name:'Create service invoice'}).waitFor();
    await page.locator('.billa-workspace').getByRole('button',{name:'Log out'}).click();
    await page.getByRole('heading',{name:'Unlock your accounting'}).waitFor();
    await context.close();
  }finally{if(browser)await browser.close();await terminate(server.child);rmSync(dir,{recursive:true,force:true});}
});
