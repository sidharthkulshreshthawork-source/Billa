import {
  bootstrapLocalOwner,loginLocal,authenticateRequest,assertSameOrigin,getSessionToken,revokeLocalSession
} from './auth.js';
import {
  prepareServiceInvoice,reviseServiceInvoice,getServiceInvoiceDraft,listServiceInvoiceDrafts,approveDraft,postApprovedInvoice
} from './invoices.js';
import {getTrialBalance,getJournal,getServiceRevenueSummary,getOpenReceivables} from './reports.js';

function error(res,e){
  if(!e.status)console.error('[Billa accounting]',e);
  return res.status(e.status||500).json({code:e.code||'ACCOUNTING_SERVER_ERROR',error:e.status?e.message:'Internal accounting error'});
}
function json(req){
  assertSameOrigin(req);
  if(!String(req.headers?.['content-type']||'').startsWith('application/json')){
    const e=new Error('JSON body required');e.status=415;e.code='INVALID_CONTENT_TYPE';throw e;
  }
}
export function registerAccountingAuthRoutes(app,{db,now=Date.now}){
  app.get('/api/v2/auth/status',(req,res)=>{
    try{assertSameOrigin(req);return res.json({accountingMode:true,initialized:!!db.prepare('SELECT 1 FROM local_users LIMIT 1').get()});}
    catch(e){return error(res,e);}
  });
  app.post('/api/v2/auth/bootstrap',(req,res)=>{
    try{json(req);const user=bootstrapLocalOwner({db,businessName:req.body?.businessName,password:req.body?.password});return res.status(201).json({businessId:user.businessId});}
    catch(e){return error(res,e);}
  });
  app.post('/api/v2/auth/login',(req,res)=>{
    try{
      json(req);const session=loginLocal({db,password:req.body?.password,now:now()});
      res.cookie('accounting_session',session.sessionToken,{
        httpOnly:true,sameSite:'strict',secure:!!req.secure,path:'/',maxAge:session.expiresAt-now()
      });
      return res.json({csrfToken:session.csrfToken,expiresAt:session.expiresAt});
    }catch(e){return error(res,e);}
  });
  app.get('/api/v2/auth/me',(req,res)=>{
    try{
      const actor=authenticateRequest({db,req,now:now()});
      const business=db.prepare('SELECT name,country,seller_state,gstin,is_gst_registered FROM businesses WHERE id=?').get(actor.businessId);
      return res.json({business,ownerId:actor.ownerId});
    }catch(e){return error(res,e);}
  });
  app.post('/api/v2/auth/logout',(req,res)=>{
    try{
      const actor=authenticateRequest({db,req,now:now()});
      revokeLocalSession({db,sessionToken:getSessionToken(req),now:now()});
      res.clearCookie('accounting_session',{path:'/'});
      return res.json({success:true,ownerId:actor.ownerId});
    }catch(e){return error(res,e);}
  });
}

/** Deny ALL non-v2 legacy endpoints when accounting mode is enabled, including financial writes. */
export function createLegacyAccountingFence({db,now=Date.now}){
  return (req,res,next)=>{
    const pathname=String(req.path||req.url||'').split('?')[0];
    if(!pathname.startsWith('/api/')||pathname.startsWith('/api/v2/')||pathname==='/api/health')return next();
    try{
      authenticateRequest({db,req,now:now()});
      return res.status(409).json({code:'ACCOUNTING_MIGRATION_REQUIRED',error:'Legacy JSON API is disabled in accounting mode. Use the secure accounting workspace.'});
    }catch(e){return error(res,e);}
  };
}
export function registerAccountingInvoiceRoutes(app,{db,now=Date.now}){
  const owner=(handler,{body=false,created=false}={})=>(req,res)=>{
    try{
      if(body)json(req);
      const actor=authenticateRequest({db,req,now:now()});
      const result=handler({req,actor});
      return res.status(created?201:200).json(result);
    }catch(e){return error(res,e);}
  };
  app.get('/api/v2/business',owner(({actor})=>db.prepare(
    'SELECT name,country,seller_state,gstin,is_gst_registered FROM businesses WHERE id=?'
  ).get(actor.businessId)));
  app.put('/api/v2/business/tax-config',owner(({actor,req})=>{
    const {sellerState,gstin,registered}=req.body||{};
    if(typeof sellerState!=='string'||!/^\d{2}$/.test(sellerState)){
      const e=new Error('Enter two-digit seller state code, e.g. 08 for Rajasthan');e.status=422;e.code='INVALID_SELLER_STATE';throw e;
    }
    const isRegistered=registered===true;
    if(isRegistered&&(typeof gstin!=='string'||!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)||!gstin.startsWith(sellerState))){
      const e=new Error('Enter a valid GSTIN that matches the seller state');e.status=422;e.code='INVALID_GSTIN';throw e;
    }
    db.prepare('UPDATE businesses SET seller_state=?,gstin=?,is_gst_registered=? WHERE id=?')
      .run(sellerState,isRegistered?gstin:null,isRegistered?1:0,actor.businessId);
    return {sellerState,gstin:isRegistered?gstin:null,registered:isRegistered};
  },{body:true}));

  app.get('/api/v2/invoices/drafts',owner(({actor})=>({drafts:listServiceInvoiceDrafts({db,actor})})));
  app.post('/api/v2/invoices/drafts',owner(({actor,req})=>prepareServiceInvoice({db,actor,input:req.body}),{body:true,created:true}));
  app.get('/api/v2/invoices/drafts/:id',owner(({actor,req})=>getServiceInvoiceDraft({db,actor,draftId:req.params.id})));
  app.put('/api/v2/invoices/drafts/:id',owner(({actor,req})=>
    reviseServiceInvoice({db,actor,draftId:req.params.id,revision:req.body?.revision,input:req.body?.input}),{body:true}));
  app.post('/api/v2/invoices/drafts/:id/approve',owner(({actor,req})=>
    approveDraft({db,actor,draftId:req.params.id,revision:req.body?.revision,digest:req.body?.digest,now:now()}),{body:true}));
  app.post('/api/v2/invoices/drafts/:id/post',owner(({actor,req})=>
    postApprovedInvoice({db,actor,draftId:req.params.id,revision:req.body?.revision,digest:req.body?.digest,
      approvalId:req.body?.approvalId,operationId:req.body?.operationId,now:now()}),{body:true,created:true}));
  app.get('/api/v2/invoices',owner(({actor})=>({invoices:db.prepare(`SELECT id AS invoiceId,invoice_number AS invoiceNumber,
    invoice_date AS invoiceDate,customer_name AS customerName,total_paise AS totalPaise,
    taxable_paise AS taxablePaise,cgst_paise AS cgstPaise,sgst_paise AS sgstPaise,igst_paise AS igstPaise,
    document_type AS documentType FROM posted_invoices WHERE business_id=?
    ORDER BY invoice_date DESC,posted_at DESC LIMIT 250`).all(actor.businessId)})));
  app.get('/api/v2/invoices/:id',owner(({actor,req})=>{
    const row=db.prepare('SELECT * FROM posted_invoices WHERE id=? AND business_id=?').get(req.params.id,actor.businessId);
    if(!row){const e=new Error('Posted invoice not found');e.status=404;e.code='NOT_FOUND';throw e;}
    return {...row,payload:JSON.parse(row.payload_json),payload_json:undefined};
  }));
  app.get('/api/v2/accounting/trial-balance',owner(({actor,req})=>
    getTrialBalance({db,businessId:actor.businessId,from:req.query?.from,to:req.query?.to})));
  app.get('/api/v2/accounting/journal',owner(({actor,req})=>
    getJournal({db,businessId:actor.businessId,from:req.query?.from,to:req.query?.to})));
  app.get('/api/v2/accounting/service-revenue',owner(({actor,req})=>
    getServiceRevenueSummary({db,businessId:actor.businessId,from:req.query?.from,to:req.query?.to})));
  app.get('/api/v2/accounting/receivables',owner(({actor,req})=>
    getOpenReceivables({db,businessId:actor.businessId,asOf:req.query?.asOf})));
}
