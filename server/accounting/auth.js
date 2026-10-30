import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { seedBusinessAccounts } from './accounts.js';
import { transaction } from './sqlite.js';

const KDF = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const pwdHash = (password,salt) => scryptSync(password,Buffer.from(salt,'hex'),KDF.keylen,KDF).toString('hex');
function fail(code,message,status=400){const e=new Error(message);e.code=code;e.status=status;throw e;}

export function bootstrapLocalOwner({db,businessName,password}){
  const name=typeof businessName==='string'?businessName.trim():'';
  if(!name||name.length>120)fail('INVALID_BUSINESS','Business name required, up to 120 characters',422);
  if(typeof password!=='string'||password.length<12||password.length>512)fail('INVALID_PASSWORD','Use a password of 12 to 512 characters',422);
  const salt=randomBytes(24).toString('hex'), secret=pwdHash(password,salt);
  return transaction(db,()=>{
    if(db.prepare('SELECT 1 FROM local_users LIMIT 1').get()||db.prepare('SELECT 1 FROM businesses LIMIT 1').get())fail('ALREADY_INITIALIZED','Local business is already registered',409);
    const businessId=randomUUID(),ownerId=randomUUID(),createdAt=new Date().toISOString();
    db.prepare('INSERT INTO businesses(id,name,created_at) VALUES(?,?,?)').run(businessId,name,createdAt);
    db.prepare('INSERT INTO local_users(id,business_id,password_salt,password_hash,kdf_params_json,created_at) VALUES(?,?,?,?,?,?)')
      .run(ownerId,businessId,salt,secret,JSON.stringify({N:KDF.N,r:KDF.r,p:KDF.p}),createdAt);
    seedBusinessAccounts(db,businessId);
    return {businessId,ownerId};
  });
}

export function loginLocal({db,password,now=Date.now()}){
  const owner=db.prepare('SELECT * FROM local_users LIMIT 1').get();
  if(!owner)fail('NOT_INITIALIZED','Create a local business before logging in',409);
  if(typeof password!=='string')fail('INVALID_CREDENTIALS','Invalid credentials',401);
  const candidate=Buffer.from(pwdHash(password,owner.password_salt),'hex');
  const stored=Buffer.from(owner.password_hash,'hex');
  if(candidate.length!==stored.length||!timingSafeEqual(candidate,stored))fail('INVALID_CREDENTIALS','Invalid credentials',401);
  const sessionToken=token(),csrfToken=token(),expiresAt=now+SESSION_MS;
  db.prepare('INSERT INTO sessions(id,business_id,owner_id,token_hash,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(),owner.business_id,owner.id,hash(sessionToken),hash(csrfToken),now,expiresAt);
  return {sessionToken,csrfToken,expiresAt};
}

export function getSessionToken(req){
  const pair=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('accounting_session='));
  return pair?pair.slice('accounting_session='.length):'';
}
export function assertSameOrigin(req){
  const origin=req.headers?.origin;
  if(!origin)return;
  let url;
  try{url=new URL(origin);}catch{fail('INVALID_ORIGIN','Cross-origin request rejected',403);}
  if(!req.headers?.host||!['http:','https:'].includes(url.protocol)||url.host.toLowerCase()!==String(req.headers.host).toLowerCase())
    fail('INVALID_ORIGIN','Cross-origin request rejected',403);
}

export function authenticateRequest({db,req,now=Date.now()}){
  assertSameOrigin(req);
  const cookie=getSessionToken(req);
  if(!cookie)fail('NOT_AUTHENTICATED','Accounting login required',401);
  const row=db.prepare(`SELECT s.* FROM sessions s JOIN local_users u
    ON u.id=s.owner_id AND u.business_id=s.business_id WHERE s.token_hash=?`).get(hash(cookie));
  if(!row||row.revoked_at!==null||row.expires_at<=now)fail('SESSION_EXPIRED','Session missing or expired; log in again',401);
  if(!['GET','HEAD','OPTIONS'].includes(String(req.method).toUpperCase())){
    const supplied=req.headers?.['x-accounting-csrf'];
    if(typeof supplied!=='string'||supplied.length<16)fail('CSRF_REJECTED','CSRF token required for changes',403);
    if(!timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(row.csrf_hash,'hex')))
      fail('CSRF_REJECTED','CSRF token is invalid',403);
  }
  return {businessId:row.business_id,ownerId:row.owner_id,sessionId:row.id};
}
export function revokeLocalSession({db,sessionToken,now=Date.now()}){
  if(!sessionToken)return false;
  return db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(now,hash(sessionToken)).changes>0;
}
