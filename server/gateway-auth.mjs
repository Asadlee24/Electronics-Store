// A narrow server-to-server capability for guest order requests. It never
// authorizes admin actions or invents a ChatGPT visitor identity.
import {ApiError} from './catalogue.mjs';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function key(secret,usage){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);}
async function message(id,timestamp,body){return encoder.encode(`${timestamp}\n${id}\n${hex(await crypto.subtle.digest('SHA-256',encoder.encode(body)))}`);}
export async function signGuest(secret,id,timestamp,body){return hex(await crypto.subtle.sign('HMAC',await key(secret,'sign'),await message(id,timestamp,body)));}
export async function gatewayGuest(request,env,body,scope='order'){
 if(scope==='contact')body='contact\n'+body;
 const id=request.headers.get('x-mdk-guest'),timestamp=request.headers.get('x-mdk-time'),signature=request.headers.get('x-mdk-signature');
 if(!env.STOREFRONT_GATEWAY_SECRET||env.STOREFRONT_GATEWAY_SECRET.length<32||!id||!/^[a-f0-9]{64}$/.test(id)||!timestamp||!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000||!signature||!/^[a-f0-9]{64}$/.test(signature))throw new ApiError(401,'Store connection could not be verified.');
 const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',await key(env.STOREFRONT_GATEWAY_SECRET,'verify'),bytes,await message(id,timestamp,body)))throw new ApiError(401,'Store connection could not be verified.');
 return {id:'guest:'+id};
}
