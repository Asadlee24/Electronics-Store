import {ApiError,identity,requireSameOrigin} from './catalogue.mjs';
const enc = new TextEncoder();
export const hex = value => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2,'0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g)||[], x=>parseInt(x,16));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const cookieName='__Host-store_admin';
export const clearCookie=`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
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
 if(request.headers.has('x-store-admin-signature')){
  const time=request.headers.get('x-store-admin-time'),signature=request.headers.get('x-store-admin-signature'),origin=request.headers.get('x-store-public-origin'),client=request.headers.get('x-store-client');
  if(!env.ADMIN_GATEWAY_SECRET||env.ADMIN_GATEWAY_SECRET.length<32||!/^\d{13}$/.test(time||'')||Math.abs(Date.now()-Number(time))>120000||!/^[a-f0-9]{64}$/.test(signature||'')||!/^[a-f0-9]{64}$/.test(client||'')||!allowedOrigins(env).has(origin))throw new ApiError(401,'Admin connection could not be verified.');
  if(!await crypto.subtle.verify('HMAC',await key(env.ADMIN_GATEWAY_SECRET,'verify'),unhex(signature),await envelope(request,time,origin,client)))throw new ApiError(401,'Admin connection could not be verified.');
  return {origin,client,email:env.ADMIN_EMAIL,id:'store-owner'};
 }
 const user=identity(request);
 if(!user)throw new ApiError(401,'Sign in to your owner account to continue.');
 if(!env.ADMIN_EMAIL||user.email!==env.ADMIN_EMAIL.toLowerCase().trim())throw new ApiError(403,'This account cannot manage the store.');
 return {...user,origin:env.STORE_ORIGIN||'https://www.mdkelectronics.com',client:await digest(user.id)};
}
export async function credentials(env){
 if(!env.DB||!env.ADMIN_EMAIL)throw new ApiError(503,'Admin setup is not available.');
 await env.DB.prepare('INSERT OR IGNORE INTO admin_credentials (id,revision) VALUES (1,0)').run();
 return env.DB.prepare('SELECT * FROM admin_credentials WHERE id=1').first();
}
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>128)throw new ApiError(400,'Use a password with 12–128 characters.');
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const imported=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 return `pbkdf2$600000$${hex(salt)}$${hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},imported,256))}`;
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>128)return false;
 const parts=/^pbkdf2\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored||'');
 if(!parts)return false;
 const imported=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const result=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(parts[1]),iterations:600000,hash:'SHA-256'},imported,256));
 let difference=0;for(let i=0;i<64;i++)difference|=result.charCodeAt(i)^parts[2].charCodeAt(i);return difference===0;
}
export async function limit(env,client,action,max=8,period=900000){
 const now=Date.now(),bucket=Math.floor(now/period),id=await digest(`${client}:${action}:${bucket}`);
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
 if(!valid||email!==env.ADMIN_EMAIL.toLowerCase().trim())throw new ApiError(401,'Email or password is incorrect.');
 const token=random(),expires=Date.now()+8*60*60*1000;
 await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<?').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO admin_sessions (token_hash,revision,expires_at) VALUES (?,?,?)').bind(await digest(token),row.revision,expires).run();
 return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
}
export async function signOut(request,env){
 await adminContext(request,env);requireSameOrigin(request);
 const token=sessionToken(request);if(token)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(token)).run();
 return clearCookie;
}
export async function requestReset(request,env,form,send){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'reset',4,3600000);
 const row=await credentials(env),email=String(form.get('email')||'').trim().toLowerCase();
 if(email!==env.ADMIN_EMAIL.toLowerCase().trim())return;
 await limit(env,'owner-reset','reset-owner',3,3600000);
 if(!env.RESEND_API_KEY)throw new ApiError(503,'Password recovery email is not configured yet.');
 const token=random(),now=Date.now();
 const result=await env.DB.prepare('UPDATE admin_credentials SET reset_hash=?,reset_expires=?,reset_sent_at=? WHERE id=1 AND (reset_sent_at IS NULL OR reset_sent_at<?)').bind(await digest(token),now+15*60000,now,now-60000).run();
 if(!result.meta.changes)return;
 // Raw tokens exist only in the message sent to the fixed owner inbox.
 try{await send({to:env.ADMIN_EMAIL,url:context.origin+'/admin/reset?token='+token,id:await digest(token)});}
 catch{await env.DB.prepare('UPDATE admin_credentials SET reset_hash=NULL,reset_expires=NULL WHERE id=1 AND reset_hash=?').bind(await digest(token)).run();throw new ApiError(503,'The email could not be sent. Please try again shortly.');}
}
export async function resetPassword(request,env,form){
 const context=await adminContext(request,env);requireSameOrigin(request);await limit(env,context.client,'set-password');
 const token=String(form.get('token')||'');if(!/^[a-f0-9]{64}$/.test(token))throw new ApiError(400,'This link is invalid or has expired. Request a new one.');
 if(form.get('password')!==form.get('confirm'))throw new ApiError(400,'The passwords do not match.');
 const row=await credentials(env),hash=await digest(token);
 if(row.reset_hash!==hash||row.reset_expires<Date.now())throw new ApiError(400,'This link is invalid or has expired. Request a new one.');
 const stored=await hashPassword(form.get('password'));
 const result=await env.DB.prepare('UPDATE admin_credentials SET password_hash=?,revision=revision+1,reset_hash=NULL,reset_expires=NULL WHERE id=1 AND reset_hash=? AND reset_expires>?').bind(stored,hash,Date.now()).run();
 if(!result.meta.changes)throw new ApiError(400,'This link has already been used. Request a new one.');
 return clearCookie;
}
