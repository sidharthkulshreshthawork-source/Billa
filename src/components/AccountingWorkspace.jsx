import {useEffect,useRef,useState} from 'react';
import {
  getAccountingStatus,getAccountingMe,bootstrapAccounting,loginAccounting,logoutAccounting,
  updateAccountingTax,listAccountingDrafts,listAccountingInvoices,getAccountingDraft,getAccountingInvoice,
  prepareAccountingInvoice,reviseAccountingInvoice,approveAccountingInvoice,postAccountingInvoice,
  getAccountingTrialBalance,getAccountingJournal,getAccountingReceivables,getAccountingRevenue
} from '../store';
import './accounting.css';

const STATES=[
  ['01','Jammu & Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],
  ['05','Uttarakhand'],['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],
  ['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],
  ['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],
  ['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],
  ['26','Dadra & Nagar Haveli and Daman & Diu'],['27','Maharashtra'],['29','Karnataka'],
  ['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],
  ['35','Andaman & Nicobar'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh']
];
const currency=amount=>(Number(amount||0)/100).toLocaleString('en-IN',{style:'currency',currency:'INR'});
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const blankLine=()=>({kind:'service',description:'',sac:'',quantity:'1',rate:'',gstPercent:''});
const blankInvoice=()=>({
  invoiceDate:today(),documentType:'tax-invoice',
  customer:{id:crypto.randomUUID(),name:''},placeOfSupplyState:'',
  lines:[blankLine()]
});
const inputClass='billa-input';

function StatePicker({value,onChange,label,required=true}){
  return <label className="billa-field"><span>{label}</span>
    <select className={inputClass} value={value||''} required={required} onChange={e=>onChange(e.target.value)}>
      <option value="">Choose state / territory</option>
      {STATES.map(([code,name])=><option key={code} value={code}>{name} · {code}</option>)}
    </select>
  </label>;
}
function MoneyLine({label,amount,strong=false}){
  return <div className={`billa-money-line${strong?' billa-money-total':''}`}>
    <span>{label}</span><strong>{currency(amount)}</strong>
  </div>;
}
function InvoicePreview({preview}){
  if(!preview)return null;
  return <div className="billa-invoice-preview">
    <p className="billa-eyebrow">SERVER-VERIFIED TOTALS</p>
    <strong>{preview.customerName}</strong>
    <small>{preview.invoiceDate} · {preview.documentType==='tax-invoice'?'GST tax invoice':'Bill of supply'}</small>
    <div className="billa-divider"/>
    <MoneyLine label="Taxable services" amount={preview.taxablePaise}/>
    {preview.cgstPaise>0&&<MoneyLine label="CGST" amount={preview.cgstPaise}/>}
    {preview.sgstPaise>0&&<MoneyLine label="SGST" amount={preview.sgstPaise}/>}
    {preview.utgstPaise>0&&<MoneyLine label="UTGST" amount={preview.utgstPaise}/>}
    {preview.igstPaise>0&&<MoneyLine label="IGST" amount={preview.igstPaise}/>}
    <MoneyLine label="Total receivable" amount={preview.totalReceivablePaise} strong/>
  </div>;
}
function PostedInvoice({invoice,onBack}){
  const p=invoice?.payload?.preview;
  if(!p)return null;
  return <div className="billa-print-document billa-panel">
    <div className="billa-print-actions"><button className="billa-btn subtle" onClick={onBack}>Back to invoices</button><button className="billa-btn primary" onClick={()=>window.print()}>Print invoice</button></div>
    <div className="billa-invoice-head"><h2>SERVICE INVOICE · ACCOUNTING COPY</h2><span className="billa-pill">Posted · Immutable</span></div>
    <p className="billa-alert info billa-statutory-warning">ACCOUNTING RECORD — NOT A STATUTORY GST TAX INVOICE</p>
    <p className="billa-muted">{invoice.invoice_number} · {invoice.invoice_date}</p>
    {p.sellerGstin&&<p>Seller GSTIN: <b>{p.sellerGstin}</b></p>}
    <p>Bill to: <b>{invoice.customer_name}</b></p>
    <table className="billa-table"><thead><tr><th>Service</th><th>SAC</th><th>Qty</th><th>Taxable</th></tr></thead>
      <tbody>{p.lines.map((line,i)=><tr key={i}><td>{line.description}</td><td>{line.sac}</td><td>{line.quantityMilliUnits/1000}</td><td>{currency(line.taxablePaise)}</td></tr>)}</tbody>
    </table>
    <div className="billa-totals"><InvoicePreview preview={p}/></div>
    <p className="billa-muted">Accounting entries are recorded and cannot be silently edited. Payments and statutory filing are not yet supported in this development mode.</p>
  </div>;
}

export default function AccountingWorkspace(){
  const [stage,setStage]=useState('loading');
  const [businessName,setBusinessName]=useState('');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [business,setBusiness]=useState(null);
  const [tab,setTab]=useState('create');
  const [form,setForm]=useState(blankInvoice);
  const [draft,setDraft]=useState(null);
  const [dirty,setDirty]=useState(true);
  const [confirmPost,setConfirmPost]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [taxConfig,setTaxConfig]=useState({sellerState:'',gstin:'',registered:false});
  const [drafts,setDrafts]=useState([]);
  const [invoices,setInvoices]=useState([]);
  const [trial,setTrial]=useState(null);
  const [receivables,setReceivables]=useState(null);
  const [revenue,setRevenue]=useState(null);
  const [journal,setJournal]=useState(null);
  const [selectedInvoice,setSelectedInvoice]=useState(null);
  const posting=useRef(false);

  async function refresh(){
    const [d,i,t,r,v,j]=await Promise.all([
      listAccountingDrafts(),listAccountingInvoices(),getAccountingTrialBalance(),
      getAccountingReceivables(),getAccountingRevenue(),getAccountingJournal()
    ]);
    setDrafts(d.drafts||[]);setInvoices(i.invoices||[]);setTrial(t);setReceivables(r);setRevenue(v);setJournal(j);
  }
  function onError(e){
    setError(e.message||'Unexpected request failure');
    if(e.status===401){setStage('login');setBusiness(null);setConfirmPost(false);}
  }
  async function loadOwner(){
    const me=await getAccountingMe();setBusiness(me.business);
    setTaxConfig({sellerState:me.business.seller_state||'',gstin:me.business.gstin||'',registered:!!me.business.is_gst_registered});
    setStage('ready');
    await refresh();
  }
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const s=await getAccountingStatus();
        if(!active)return;
        if(!s.initialized){setStage('setup');return;}
        try{await loadOwner();}catch(e){if(active)onError(e.status===401?{message:'Enter your password to open your local books',status:401}:e);}
      }catch(e){if(active){setStage('failure');setError(e.message);}}
    })();
    return ()=>{active=false;};
  },[]);

  async function handleAuth(event){
    event.preventDefault();setError('');setNotice('');
    if(stage==='setup'&&password!==confirmPassword){setError('Passwords do not match');return;}
    setBusy(true);
    try{
      if(stage==='setup')await bootstrapAccounting({businessName,password});
      await loginAccounting(password);
      setPassword('');setConfirmPassword('');
      await loadOwner();
      setNotice('Your local accounting workspace is ready.');
    }catch(e){onError(e);}
    finally{setBusy(false);}
  }
  async function handleLogout(){
    setBusy(true);
    try{await logoutAccounting();}catch(e){setNotice(e.message);}
    finally{setStage('login');setBusiness(null);setTaxConfig({sellerState:'',gstin:'',registered:false});setBusy(false);}
  }
  function editForm(update){
    setForm(current=>typeof update==='function'?update(current):{...current,...update});
    setDirty(true);setConfirmPost(false);setError('');setNotice('');
  }
  function editLine(index,patch){editForm(current=>({...current,lines:current.lines.map((x,i)=>i===index?{...x,...patch}:x)}));}
  function makeInput(){
    return {...form,lines:form.lines.map(line=>({
      ...line,gstPercent:form.documentType==='bill-of-supply'?'0':line.gstPercent
    }))};
  }
  async function saveDraft(){
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const input=makeInput();
      const saved=draft?await reviseAccountingInvoice(draft.draftId,draft.revision,input):await prepareAccountingInvoice(input);
      setDraft({...saved,input});setDirty(false);
      setNotice(saved.errors.length?'Draft saved. Correct the listed details before posting.':'Draft saved. Review the verified amounts before posting.');
      await refresh();
    }catch(e){onError(e);}finally{setBusy(false);}
  }
  async function openDraft(id){
    setBusy(true);setError('');setSelectedInvoice(null);
    try{
      const d=await getAccountingDraft(id);
      setDraft(d);setForm(d.input);setDirty(false);setTab('create');
      setNotice('Draft loaded. No journal entries have been posted.');
    }catch(e){onError(e);}finally{setBusy(false);}
  }
  async function openInvoice(id){
    setBusy(true);setError('');
    try{const invoice=await getAccountingInvoice(id);setSelectedInvoice(invoice);setTab('invoices');}
    catch(e){onError(e);}finally{setBusy(false);}
  }
  async function finalize(){
    if(posting.current||!draft||dirty||draft.errors?.length)return;
    posting.current=true;setBusy(true);setError('');
    // Keep operation id stable if a response is lost or the same button is clicked twice.
    const key='billa-post-'+draft.draftId;
    let operationId=sessionStorage.getItem(key);
    if(!operationId){operationId=crypto.randomUUID();sessionStorage.setItem(key,operationId);}
    try{
      const approval=await approveAccountingInvoice(draft.draftId,draft.revision,draft.digest);
      const receipt=await postAccountingInvoice(draft.draftId,draft.revision,draft.digest,approval.approvalId,operationId);
      const posted=await getAccountingInvoice(receipt.invoiceId);
      setSelectedInvoice(posted);setDraft(null);setDirty(true);setConfirmPost(false);
      setTab('invoices');setNotice(`Invoice ${receipt.invoiceNumber} posted with balanced accounts.`);
      sessionStorage.removeItem(key);
      await refresh();
    }catch(e){setConfirmPost(false);onError(e);await refresh().catch(()=>{});}
    finally{setBusy(false);posting.current=false;}
  }
  async function saveTax(){
    setBusy(true);setError('');setNotice('');
    try{
      await updateAccountingTax(taxConfig);
      const me=await getAccountingMe();setBusiness(me.business);
      setDraft(null);setDirty(true);setConfirmPost(false);
      setNotice('Business tax settings saved. Any older draft must be loaded and reviewed again.');
    }catch(e){onError(e);}finally{setBusy(false);}
  }
  function newInvoice(){setForm(blankInvoice());setDraft(null);setDirty(true);setError('');setNotice('');setTab('create');setSelectedInvoice(null);}
  if(stage==='loading')return <main className="billa-auth-shell"><div className="billa-panel">Opening your local accounting workspace…</div></main>;
  if(stage==='failure')return <main className="billa-auth-shell"><div className="billa-panel"><h1>Accounting mode unavailable</h1><p>{error}</p><p>Requires Node.js 22.16 or newer and a writable accounting data directory.</p></div></main>;
  if(stage==='setup'||stage==='login')return <main className="billa-auth-shell">
    <div className="billa-auth-brand"><div className="billa-logo">B</div><h1>Billa</h1><p>Simple invoices. Proper books.</p></div>
    <form className="billa-panel billa-auth-card" onSubmit={handleAuth}>
      <p className="billa-eyebrow">OFFLINE · PRIVATE · ONE BUSINESS</p>
      <h2>{stage==='setup'?'Create your business':'Unlock your accounting'}</h2>
      <p className="billa-muted">{stage==='setup'?'Your books are stored on this computer. No cloud account required.':'Sign in with your local owner password.'}</p>
      {stage==='setup'&&<label className="billa-field"><span>Business name</span><input className={inputClass} required maxLength={120} value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Sharma Services"/></label>}
      <label className="billa-field"><span>Owner password (12+ characters)</span><input className={inputClass} type="password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={stage==='setup'?'new-password':'current-password'}/></label>
      {stage==='setup'&&<label className="billa-field"><span>Confirm password</span><input className={inputClass} type="password" required minLength={12} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password"/></label>}
      {error&&<p role="alert" className="billa-alert error">{error}</p>}
      <button className="billa-btn primary" disabled={busy} type="submit">{busy?'Working…':stage==='setup'?'Create local business':'Unlock books'}</button>
      <p className="billa-muted billa-small">No automatic cloud sync. Keep an independent backup of your accounting database.</p>
    </form>
  </main>;

  return <div className="billa-workspace">
    <header className="billa-topbar">
      <div className="billa-brand"><span className="billa-logo">B</span><div><strong>Billa</strong><small>{business?.name||'Accounting'}</small></div></div>
      <nav className="billa-nav" aria-label="Accounting pages">
        {[['create','New invoice'],['drafts','Drafts'],['invoices','Posted invoices'],['ledger','Accounts'],['settings','GST settings']].map(([id,label])=>
          <button key={id} type="button" className={tab===id?'active':''} onClick={()=>{setTab(id);if(id==='invoices')setSelectedInvoice(null);setError('');setConfirmPost(false);}}>{label}</button>)}
      </nav>
      <button className="billa-btn subtle" onClick={handleLogout} disabled={busy}>Log out</button>
    </header>
    <main className="billa-content">
      <div className="billa-page-heading"><div><p className="billa-eyebrow">LOCAL ACCOUNTING · DEVELOPMENT PREVIEW</p>
        <h1>{({create:'Create service invoice',drafts:'Unposted drafts',invoices:'Posted invoices',ledger:'Your accounts',settings:'Business GST settings'})[tab]}</h1>
        <p>Clear invoices, automatic entries, and figures you can check.</p>
      </div><span className="billa-pill">Offline-first · INR</span></div>
      {error&&<div className="billa-alert error" role="alert">{error}</div>}
      {notice&&<div className="billa-alert success" role="status">{notice}</div>}
      <div className="billa-alert info"><b>First feature only:</b> service credit invoices and read-only receivables are supported.
        Stock billing, receipts, full P&amp;L, GST filing, cloud sync and MCP are not enabled in this workspace.</div>

      {tab==='settings'&&<section className="billa-panel billa-settings-panel">
        <h2>Business tax identity</h2>
        <p className="billa-muted">Set your real registration details. Tax amounts are never guessed from the service name.</p>
        <StatePicker label="Seller state" value={taxConfig.sellerState} onChange={value=>setTaxConfig(x=>({...x,sellerState:value}))}/>
        <label className="billa-checkbox"><input type="checkbox" checked={taxConfig.registered} onChange={e=>setTaxConfig(x=>({...x,registered:e.target.checked}))}/> Registered under GST</label>
        {taxConfig.registered&&<label className="billa-field"><span>GSTIN</span><input className={inputClass} placeholder="08AAAAA0000A1Z5" value={taxConfig.gstin} maxLength={15} onChange={e=>setTaxConfig(x=>({...x,gstin:e.target.value.toUpperCase().trim()}))}/></label>}
        <button className="billa-btn primary" disabled={busy} onClick={saveTax}>Save GST settings</button>
      </section>}

      {tab==='create'&&<div className="billa-split">
        <section className="billa-panel">
          <div className="billa-flex-between"><h2>Invoice details</h2><button className="billa-btn subtle" onClick={newInvoice}>Start fresh</button></div>
          {!business?.seller_state&&<p className="billa-alert info">Set your seller state in GST settings before posting an invoice.</p>}
          <div className="billa-form-grid">
            <label className="billa-field"><span>Invoice date</span><input className={inputClass} type="date" required value={form.invoiceDate} onChange={e=>editForm({invoiceDate:e.target.value})}/></label>
            <label className="billa-field"><span>Document type</span><select className={inputClass} value={form.documentType} onChange={e=>editForm({documentType:e.target.value})}>
              <option value="tax-invoice">GST tax invoice</option><option value="bill-of-supply">Bill of supply (no GST)</option></select></label>
            <label className="billa-field billa-wide"><span>Customer name</span><input className={inputClass} value={form.customer.name} placeholder="Ramesh Traders" onChange={e=>editForm(x=>({...x,customer:{...x.customer,name:e.target.value}}))}/></label>
            <StatePicker label="Place of supply" value={form.placeOfSupplyState} onChange={value=>editForm({placeOfSupplyState:value})}/>
          </div>
          <div className="billa-flex-between"><h2>Services</h2><button className="billa-btn subtle" onClick={()=>editForm(x=>({...x,lines:[...x.lines,blankLine()]}))}>+ Add line</button></div>
          {form.lines.map((line,i)=><div className="billa-line-grid" key={i}>
            <label className="billa-field billa-wide"><span>Service description</span><input className={inputClass} value={line.description} onChange={e=>editLine(i,{description:e.target.value})} placeholder="Annual maintenance"/></label>
            <label className="billa-field"><span>SAC (6 digits)</span><input className={inputClass} value={line.sac} onChange={e=>editLine(i,{sac:e.target.value})} placeholder="998314" maxLength={6}/></label>
            <label className="billa-field"><span>Quantity</span><input className={inputClass} value={line.quantity} onChange={e=>editLine(i,{quantity:e.target.value})} inputMode="decimal"/></label>
            <label className="billa-field"><span>Unit rate (₹)</span><input className={inputClass} value={line.rate} onChange={e=>editLine(i,{rate:e.target.value})} placeholder="10000.00" inputMode="decimal"/></label>
            {form.documentType==='tax-invoice'&&<label className="billa-field"><span>GST rate</span><select className={inputClass} value={line.gstPercent} onChange={e=>editLine(i,{gstPercent:e.target.value})}>
              <option value="">Choose rate</option>{['5','12','18','28','40'].map(v=><option key={v} value={v}>{v}%</option>)}
            </select></label>}
            {form.lines.length>1&&<button className="billa-btn remove" onClick={()=>editForm(x=>({...x,lines:x.lines.filter((_,index)=>index!==i)}))}>Remove line</button>}
          </div>)}
          <div className="billa-action-row">
            <button className="billa-btn primary" onClick={saveDraft} disabled={busy}>{busy?'Working…':draft?'Save revised draft':'Save draft & calculate'}</button>
            <button className="billa-btn success" disabled={busy||dirty||!draft?.preview||!!draft?.errors?.length} onClick={()=>setConfirmPost(true)}>Review & post invoice</button>
          </div>
          {draft&&<p className="billa-muted billa-small">Draft revision {draft.revision}. {dirty?'Unsaved changes — save again before posting.':'Not posted until you explicitly confirm.'}</p>}
        </section>
        <aside className="billa-panel"><h2>Live accounting preview</h2>
          {draft&&!dirty?<><InvoicePreview preview={draft.preview}/>
            {draft.errors?.length>0&&<div className="billa-alert error" role="alert"><b>Fix before posting:</b><ul>{draft.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
          </>:<div className="billa-empty">Save your draft to calculate and verify GST. No accounting entries are made until you confirm posting.</div>}
        </aside>
      </div>}

      {tab==='drafts'&&<section className="billa-panel">
        {drafts.length===0?<div className="billa-empty">No drafts yet. Start with a new service invoice.</div>:
          <div className="billa-list">{drafts.map(d=><button key={d.draftId} className="billa-list-row" onClick={()=>openDraft(d.draftId)}>
            <div><b>{d.input?.customer?.name||'Unnamed customer'}</b><small>Revision {d.revision} · {d.input?.invoiceDate}</small></div>
            <div>{d.preview?currency(d.preview.totalReceivablePaise):'Incomplete'} <span className="billa-chevron">Open →</span></div>
          </button>)}</div>}
      </section>}

      {tab==='invoices'&&(selectedInvoice?<PostedInvoice invoice={selectedInvoice} onBack={()=>setSelectedInvoice(null)}/>:
        <section className="billa-panel">{invoices.length===0?<div className="billa-empty">No posted invoices yet.</div>:
          <table className="billa-table"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Amount</th><th></th></tr></thead>
          <tbody>{invoices.map(i=><tr key={i.invoiceId}>
            <td><b>{i.invoiceNumber}</b></td><td>{i.invoiceDate}</td><td>{i.customerName}</td><td>{currency(i.totalPaise)}</td>
            <td><button className="billa-btn subtle" onClick={()=>openInvoice(i.invoiceId)}>View / print</button></td>
          </tr>)}</tbody></table>}</section>)}

      {tab==='ledger'&&<div className="billa-report-stack">
        <div className="billa-metric-grid">
          <div className="billa-panel billa-metric"><span>Service revenue (not profit)</span><strong>{currency(revenue?.revenuePaise)}</strong></div>
          <div className="billa-panel billa-metric"><span>Output GST</span><strong>{currency(revenue?.gstOutputPaise)}</strong></div>
          <div className="billa-panel billa-metric"><span>Open receivables</span><strong>{currency(receivables?.totalOpenPaise)}</strong></div>
          <div className="billa-panel billa-metric"><span>Posted invoices</span><strong>{revenue?.invoiceCount||0}</strong></div>
        </div>
        <section className="billa-panel"><h2>Trial balance {trial?.balanced?'✓ Balanced':'—'}</h2>
          {!trial?.accounts?.length?<div className="billa-empty">Post a service invoice to create your first journal.</div>:
            <table className="billa-table"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
              <tbody>{trial.accounts.map(a=><tr key={a.code}><td>{a.code} · {a.name}</td><td>{currency(a.debitPaise)}</td><td>{currency(a.creditPaise)}</td></tr>)}
              <tr><td><b>Total</b></td><td><b>{currency(trial.totalDebitPaise)}</b></td><td><b>{currency(trial.totalCreditPaise)}</b></td></tr></tbody></table>}
        </section>
        <section className="billa-panel"><h2>Customer receivables</h2>
          {!receivables?.invoices?.length?<div className="billa-empty">No unpaid service invoices.</div>:
            <table className="billa-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Outstanding</th></tr></thead>
              <tbody>{receivables.invoices.map(i=><tr key={i.invoiceId}><td>{i.invoiceNumber}</td><td>{i.customerName}</td><td>{currency(i.amountDuePaise)}</td></tr>)}</tbody></table>}
        </section>
        <section className="billa-panel"><h2>Posted journal</h2>
          {!journal?.entries?.length?<div className="billa-empty">Nothing posted yet.</div>:
            journal.entries.map(j=><div className="billa-journal" key={j.journalId}><b>{j.invoiceNumber} · {j.entryDate}</b>
              <table className="billa-table"><tbody>{j.lines.map((line,i)=><tr key={i}><td>{line.name}</td><td>Dr {currency(line.debitPaise)}</td><td>Cr {currency(line.creditPaise)}</td></tr>)}</tbody></table>
            </div>)}
        </section>
      </div>}
    </main>
    {confirmPost&&draft?.preview&&<div className="billa-modal-backdrop" role="presentation">
      <div className="billa-modal" role="dialog" aria-modal="true" aria-label="Confirm invoice posting">
        <h2>Confirm financial posting</h2>
        <p>This creates an irreversible accounting entry. Please verify the exact GST breakdown.</p>
        <InvoicePreview preview={draft.preview}/>
        <div className="billa-action-row"><button className="billa-btn subtle" onClick={()=>setConfirmPost(false)} disabled={busy}>Cancel</button>
          <button className="billa-btn success" onClick={finalize} disabled={busy}>{busy?'Posting…':'Confirm and post'}</button></div>
      </div>
    </div>}
  </div>;
}
