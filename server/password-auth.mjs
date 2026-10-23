const enc=new TextEncoder();
const bytes=s=>Uint8Array.from(s.match(/../g)||[],v=>parseInt(v,16));
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const key=async(secret,usage)=>crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
export async function checkPassword(password,env){
 const stored=env.ADMIN_PASSWORD_HASH||'';
 const [salt,digest]=stored.split(':');
 if(!/^[0-9a-f]{32}$/.test(salt||'')||!/^[0-9a-f]{64}$/.test(digest||'')||typeof password!=='string'||password.length>256)return false;
 const imported=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const result=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes(salt),iterations:250000,hash:'SHA-256'},imported,256));
 let diff=0;for(let i=0;i<64;i++)diff|=result.charCodeAt(i)^digest.charCodeAt(i);
 return diff===0;
}
export async function createAdminCookie(user,env){
 if(!env.ADMIN_SESSION_SECRET||env.ADMIN_SESSION_SECRET.length<32)throw Error('Admin session secret is missing.');
 const exp=Date.now()+12*60*60*1000, payload=exp+'.'+hex(await crypto.subtle.digest('SHA-256',enc.encode(user.id+'|'+user.email)));
 const signature=hex(await crypto.subtle.sign('HMAC',await key(env.ADMIN_SESSION_SECRET,'sign'),enc.encode(payload)));
 return 'mdk_admin='+payload+'.'+signature+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200';
}
export async function hasAdminSession(request,user,env){
 if(!env.ADMIN_SESSION_SECRET||env.ADMIN_SESSION_SECRET.length<32)return false;
 const v=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('mdk_admin='))?.slice(10)||'';
 const match=/^(\d{13})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(v);
 if(!match||Number(match[1])<Date.now()||Number(match[1])>Date.now()+43200000)return false;
 const expected=hex(await crypto.subtle.digest('SHA-256',enc.encode(user.id+'|'+user.email)));
 if(expected!==match[2])return false;
 const signed=match[1]+'.'+match[2];
 return crypto.subtle.verify('HMAC',await key(env.ADMIN_SESSION_SECRET,'verify'),bytes(match[3]),enc.encode(signed));
}
export const clearAdminCookie='mdk_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
