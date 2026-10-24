import {scryptSync,timingSafeEqual} from 'node:crypto';
import {ApiError,identity,requireSameOrigin} from './catalogue.mjs';
import {ownerEmail,emailAddress} from './mail-settings.mjs';
const enc = new TextEncoder();
export const hex = value => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2,'0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g)||[], x=>parseInt(x,16));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const cookieName='__Host-store_admin';
export const clearCookie=`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const key = (secret,usage)=>crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
const allowedOrigins = env => new Set(['https://mdkelectronics.com','https://www.mdkelectronics.com','https://electronics-store-eight-sigma.vercel.app',...(env.STORE_ORIGIN?[env.STORE_ORIGIN]:[])]);
async function envelope(request,time,origin,client){
 const url=new URL(request.url);
 return enc.encode([time,request.method,url.pathname+url.search,origin,client,request.headers.get('content-type')||'',await digest(request.headers.get('cookie')||''),await digest(await request.clone().arrayBuffer())].join('\n'));
}
export async function adminGatewayHeaders(request,secret,client){
 if(!secret||secret.length<32)throw new ApiError(503,'Admin connection is not configured.');
 const time=String(Date.now()),origin=new URL(request.url).origin;
 const signature=hex(await crypto.subtle.sign('HMAC',await key(secret,'sign'),await envelope(request,time,origin,client)));
 return {'x-store-admin-time':time,'x-store-admin-signature':signature,'x-store-public-origin':origin,'x-store-client':client};
}
export async function adminContext(request,env){
 if(!env.ADMIN_EMAIL)throw new ApiError(403,'Admin is not configured.');
 const owner=await ownerEmail(env);
 if(request.headers.has('x-store-admin-signature')){
  const time=request.headers.get('x-store-admin-time'),signature=request.headers.get('x-store-admin-signature'),origin=request.headers.get('x-store-public-origin'),client=request.headers.get('x-store-client');
  if(!env.ADMIN_GATEWAY_SECRET||env.ADMIN_GATEWAY_SECRET.length<32||!/^\d{13}$/.test(time||'')||Math.abs(Date.now()-Number(time))>120000||!/^[a-f0-9]{64}$/.test(signature||'')||!/^[a-f0-9]{64}$/.test(client||'')||!allowedOrigins(env).has(origin))throw new ApiError(401,'Admin connection could not be verified.');
  if(!await crypto.subtle.verify('HMAC',await key(env.ADMIN_GATEWAY_SECRET,'verify'),unhex(signature),await envelope(request,time,origin,client)))throw new ApiError(401,'Admin connection could not be verified.');
  await applyOwnerRecovery(env,owner);
  return {origin,client,email:owner,id:'store-owner'};
 }
 const user=identity(request);
 if(!user)throw new ApiError(401,'Sign in to your owner account to continue.');
 if(!env.ADMIN_EMAIL||user.email!==owner)throw new ApiError(403,'This account cannot manage the store.');
 await applyOwnerRecovery(env,owner);
 return {...user,origin:env.STORE_ORIGIN||'https://www.mdkelectronics.com',client:await digest(user.id)};
}
// A deployment-owner recovery is consumed once by nonce. Only the hosting
// owner can provide these runtime secrets; browser input never controls them.
async function applyOwnerRecovery(env,owner){
 const id=env.ADMIN_RECOVERY_ID,hash=env.ADMIN_RECOVERY_PASSWORD_HASH;
 if(!/^[a-f0-9]{64}$/.test(id||'')||!/^scrypt\$16384\$8\$5\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(hash||'')||String(env.ADMIN_RECOVERY_EMAIL||'').toLowerCase().trim()!==owner)return;
 await env.DB.prepare('INSERT OR IGNORE INTO admin_credentials (id,revision) VALUES (1,0)').run();
 await env.DB.prepare('UPDATE admin_credentials SET password_hash=?,recovery_id=?,revision=revision+1,reset_hash=NULL,reset_expires=NULL,reset_sent_at=NULL,pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL WHERE id=1 AND (recovery_id IS NULL OR recovery_id<>?)').bind(hash,id,id).run();
}
export async function credentials(env){
 if(!env.DB||!env.ADMIN_EMAIL)throw new ApiError(503,'Admin setup is not available.');
 await env.DB.prepare('INSERT OR IGNORE INTO admin_credentials (id,revision) VALUES (1,0)').run();
 return env.DB.prepare('SELECT * FROM admin_credentials WHERE id=1').first();
}
// Native scrypt avoids the production Workers WebCrypto PBKDF2 ceiling.
// Fixed parameters bound work and memory; arbitrary stored parameters are rejected.
const scryptOptions={N:16384,r:8,p:5,maxmem:32*1024*1024};
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<10||password.length>128)throw new ApiError(400,'Use a password with 10–128 characters.');
 const salt=crypto.getRandomValues(new Uint8Array(16));
 return `scrypt$16384$8$5$${hex(salt)}$${scryptSync(password,salt,32,scryptOptions).toString('hex')}`;
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>128)return false;
 const parts=/^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored||'');
 if(!parts)return false;
 return timingSafeEqual(scryptSync(password,unhex(parts[1]),32,scryptOptions),unhex(parts[2]));
}
export async function limit(env,client,action,max=8,period=900000){
 const revision=(await env.DB.prepare('SELECT revision FROM admin_credentials WHERE id=1').first())?.revision||0;
 const now=Date.now(),bucket=Math.floor(now/period),id=await digest(`${revision}:${client}:${action}:${bucket}`);
 await env.DB.prepare('DELETE FROM admin_attempts WHERE expires_at<?').bind(now).run();
 const row=await env.DB.prepare('INSERT INTO admin_attempts (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,now+period).first();
 if(row.count>max)throw new ApiError(429,'Too many attempts. Please try again later.');
}
const sessionToken=request=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
export async function adminSession(request,env){
 const token=sessionToken(request);if(!/^[a-f0-9]{64}$/.test(token))return null;
 return env.DB.prepare('SELECT s.token_hash FROM admin_sessions s JOIN admin_credentials c ON c.id=1 AND c.revision=s.revision WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first();
}
export async function requireAdminSession(request,env){
 const context=await adminContext(request,env);
 if(!await adminSession(request,env))throw new ApiError(401,'Your session has expired. Sign in again.');
 return context;
}
export async function signIn(request,env,form){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'login');
 const row=await credentials(env),email=String(form.get('email')||'').trim().toLowerCase();
 // Always perform the password derivation for a configured account, including
 // mismatched email addresses. No password or token is logged.
 const valid=await verifyPassword(form.get('password'),row.password_hash);
 if(!valid||email!==context.email)throw new ApiError(401,'Email or password is incorrect.');
 const token=random(),expires=Date.now()+8*60*60*1000;
 await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO admin_sessions (token_hash,revision,expires_at) VALUES (?,?,?)').bind(await digest(token),row.revision,expires).run();
 return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
}
export async function signOut(request,env){
 await adminContext(request,env);requireSameOrigin(request);
 const token=sessionToken(request);if(token)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(token)).run();
 return clearCookie;
}
export async function requestReset(request,env,form,send){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'reset',4,3600000);
 const row=await credentials(env),email=String(form.get('email')||'').trim().toLowerCase();
 if(email!==context.email)return;
 await limit(env,'owner-reset','reset-owner',3,3600000);
 if(!env.RESEND_API_KEY)throw new ApiError(503,'Password recovery email is not configured yet.');
 const token=random(),now=Date.now();
 const result=await env.DB.prepare('UPDATE admin_credentials SET reset_hash=?,reset_expires=?,reset_sent_at=? WHERE id=1 AND (reset_sent_at IS NULL OR reset_sent_at<?)').bind(await digest(token),now+15*60000,now,now-60000).run();
 if(!result.meta.changes)return;
 // Raw tokens exist only in the message sent to the fixed owner inbox.
 try{await send({to:context.email,url:context.origin+'/admin/reset?token='+token,id:await digest(token)});}
 catch{await env.DB.prepare('UPDATE admin_credentials SET reset_hash=NULL,reset_expires=NULL WHERE id=1 AND reset_hash=?').bind(await digest(token)).run();throw new ApiError(503,'The email could not be sent. Please try again shortly.');}
}
export async function resetPassword(request,env,form){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'set-password');
 const token=String(form.get('token')||'');if(!/^[a-f0-9]{64}$/.test(token))throw new ApiError(400,'This link is invalid or has expired. Request a new one.');
 if(form.get('password')!==form.get('confirm'))throw new ApiError(400,'The passwords do not match.');
 const row=await credentials(env),hash=await digest(token);
 if(row.reset_hash!==hash||row.reset_expires<Date.now())throw new ApiError(400,'This link is invalid or has expired. Request a new one.');
 const stored=await hashPassword(form.get('password'));
 const result=await env.DB.prepare('UPDATE admin_credentials SET password_hash=?,revision=revision+1,reset_hash=NULL,reset_expires=NULL,pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL WHERE id=1 AND reset_hash=? AND reset_expires>?').bind(stored,hash,Date.now()).run();
 if(!result.meta.changes)throw new ApiError(400,'This link has already been used. Request a new one.');
 return clearCookie;
}

export async function reauthenticate(request,env,password){
 const context=await requireAdminSession(request,env);requireSameOrigin(request);await limit(env,context.client,'reauth',5);
 const row=await credentials(env);if(!await verifyPassword(password,row.password_hash))throw new ApiError(401,'Your current password is incorrect.');
 return {...context,credentialRevision:row.revision};
}
export async function requestOwnerEmailChange(request,env,input,send){
 const context=await reauthenticate(request,env,input.currentPassword),email=String(input.email||'').trim().toLowerCase();
 if(!emailAddress(email))throw new ApiError(400,'Enter a valid new owner email.');
 if(email===context.email)throw new ApiError(400,'That is already your owner email.');
 await limit(env,'owner-change','owner-change',3,3600000);
 const token=random(),hash=await digest(token),expires=Date.now()+15*60000;
 const changed=await env.DB.prepare('UPDATE admin_credentials SET pending_email=?,pending_email_hash=?,pending_email_expires=? WHERE id=1 AND revision=?').bind(email,hash,expires,context.credentialRevision).run();
 if(!changed.meta.changes)throw new ApiError(409,'Your credentials changed. Sign in again.');
 try{await send({to:email,url:context.origin+'/admin/verify-email?token='+token,id:hash})}
 catch(error){await env.DB.prepare('UPDATE admin_credentials SET pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL WHERE id=1 AND pending_email_hash=?').bind(hash).run();throw error}
 return {pendingEmail:email};
}
export async function confirmOwnerEmail(request,env,token){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'confirm-owner',8);
 if(!/^[a-f0-9]{64}$/.test(token||''))throw new ApiError(400,'This email verification link is invalid or has expired.');
 const result=await env.DB.prepare('UPDATE admin_credentials SET owner_email=pending_email,password_hash=NULL,pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL,revision=revision+1,reset_hash=NULL,reset_expires=NULL,reset_sent_at=NULL WHERE id=1 AND pending_email_hash=? AND pending_email_expires>? AND pending_email IS NOT NULL').bind(await digest(token),Date.now()).run();
 if(!result.meta.changes)throw new ApiError(400,'This email verification link is invalid or has already been used.');
 return clearCookie;
}
