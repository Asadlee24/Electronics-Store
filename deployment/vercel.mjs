import {createHmac,randomUUID} from 'node:crypto';
import {route} from '../server/router.mjs';
import {signGuest} from '../server/gateway-auth.mjs';
import {adminGatewayHeaders} from '../server/admin-auth.mjs';
import {accessPage} from '../server/access-page.mjs';
import originalProducts from '../src/catalog.json' with {type:'json'};
import {validateOrder,orderMessage} from '../server/catalogue.mjs';

// The browser can reach only these public backend operations. Never forward
// visitor cookies, identity headers, arbitrary URLs, or admin API requests.
export const BACKEND_ORIGIN='https://mdk-electronics-preview.asadaly416.chatgpt.site';
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Upstream edge cookies belong to the private backend, not the public store.
// Never combine them with the host-only admin cookie: a backend Domain
// attribute on a combined Set-Cookie line makes browsers reject the session.
export function adminSessionCookies(headers){
 const values=typeof headers.getSetCookie==='function'?headers.getSetCookie():[headers.get('set-cookie')||''];
 return values.flatMap(value=>value.split(/,(?=\s*[^\s;,=]+\s*=)/)).map(value=>value.trim()).filter(value=>/^__Host-store_admin=[a-f0-9]*;/.test(value));
}
export async function storefront(request,env=process.env,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname.replace(/\/$/,'')||'/';
 const token=env.MDK_SITES_SERVICE_TOKEN,secret=env.STOREFRONT_GATEWAY_SECRET;
 const hasBackend=Boolean(token&&secret&&secret.length>=32);
 if(path==='/admin'||path.startsWith('/admin/')||path.startsWith('/api/admin/')){
  if(!token||!env.ADMIN_GATEWAY_SECRET||env.ADMIN_GATEWAY_SECRET.length<32)return new Response(accessPage({mode:'unavailable',message:'The owner connection is not configured yet.'}),{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  if(!['GET','HEAD','POST','PATCH'].includes(request.method))return json({error:'Method not allowed.'},405);
  if(!['GET','HEAD'].includes(request.method)&&(request.headers.get('origin')!==url.origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))))return json({error:'Please use the form on this site.'},403);
  try{
   const cookie=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('__Host-store_admin=')).join('; ');
   const contentType=request.headers.get('content-type')||'';
   const raw=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
   if(raw&&raw.byteLength>(path==='/api/admin/upload'?4*1024*1024:50000))return json({error:'Request is too large.'},413);
   const signingRequest=new Request(url,{method:request.method,headers:{cookie,...(contentType?{'Content-Type':contentType}:{})},...(raw?{body:raw}:{})});
   const client=createHmac('sha256',env.ADMIN_GATEWAY_SECRET).update(request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()||'shared-visitor').digest('hex');
   const signed=await adminGatewayHeaders(signingRequest,env.ADMIN_GATEWAY_SECRET,client);
   const response=await fetcher(BACKEND_ORIGIN+url.pathname+url.search,{method:request.method,headers:{'OAI-Sites-Authorization':'Bearer '+token,cookie,...signed,...(contentType?{'Content-Type':contentType}:{}),Origin:BACKEND_ORIGIN,'Sec-Fetch-Site':'same-origin'},...(raw?{body:raw}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
   // Keep the browser Origin on same-site form posts; suppress referrers
   // on external navigation so recovery tokens cannot leak to other sites.
   const headers=new Headers({'Content-Type':response.headers.get('content-type')||'text/plain','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff'});
   for(const name of ['content-security-policy','x-frame-options']){const value=response.headers.get(name);if(value)headers.set(name,value);}
   for(const cookie of adminSessionCookies(response.headers))headers.append('Set-Cookie',cookie.replace(/SameSite=Strict/i,'SameSite=Lax'));
   const location=response.headers.get('location');
   if(location){if(!location.startsWith('/admin')||location.startsWith('//'))throw Error('Unexpected admin redirect');headers.set('Location',location);}
   return new Response(response.body,{status:response.status,headers});
  }catch{return new Response(accessPage({mode:'unavailable',message:'Please try again shortly.'}),{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
 }

 if(path==='/api/contact'&&request.method==='POST'){
  if(!hasBackend)return json({error:'Messages are temporarily unavailable. Please contact us on WhatsApp.'},503);
  if(request.headers.get('origin')!==url.origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))return json({error:'Please use the contact form on this site.'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Send JSON data.'},415);
  try{
   const raw=await request.text();if(raw.length>10000)return json({error:'Your message is too large.'},413);
   let parsed;try{parsed=JSON.parse(raw)}catch{return json({error:'Invalid message data.'},400)}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return json({error:'Invalid message data.'},400);
   const body=JSON.stringify(parsed),client=createHmac('sha256',secret).update('contact-client:'+(request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()||'shared-visitor')).digest('hex'),time=String(Date.now());
   const response=await fetcher(BACKEND_ORIGIN+'/api/contact',{method:'POST',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json',Origin:BACKEND_ORIGIN,'Sec-Fetch-Site':'same-origin','x-mdk-guest':client,'x-mdk-time':time,'x-mdk-signature':await signGuest(secret,client,time,'contact\n'+body)},body,redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid store response');return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return json({error:'We could not confirm your message. Please try again or contact us on WhatsApp.'},503)}
 }

 if(!hasBackend){
  try{
   if(path==='/api/orders'&&request.method==='POST'){
    if(request.headers.get('origin')!==url.origin&&['cross-site'].includes(request.headers.get('sec-fetch-site')))return json({error:'Please submit this request from the store.'},403);
    if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Send JSON data.'},415);
    const raw=await request.text();if(raw.length>50000)return json({error:'Request is too large.'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid request data.'},400);}
    const order=validateOrder(body,originalProducts);
    const reference='MDK-'+randomUUID().slice(0,8).toUpperCase();
    return json({saved:false,reference,whatsappUrl:'https://wa.me/923145851509?text='+encodeURIComponent(orderMessage({...order,reference}))},201);
   }
   if(path.startsWith('/media/'))return json({error:'Image not found.'},404);
   if(path.startsWith('/api/')&&path!=='/api/catalog')return json({error:'Page not found.'},404);
   if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
   if(path==='/api/catalog')return json(originalProducts,200);
   const load=async()=>originalProducts;
   return await route(new Request(url,{method:request.method}),{CATALOGUE:load})||json({error:'Page not found.'},404);
  }catch(err){
   if(err.status)return json({error:err.message},err.status);
   return json({error:'The store is temporarily unavailable. Please try again shortly.'},503);
  }
 }
 async function upstream(endpoint,options={}){
  const response=await fetcher(BACKEND_ORIGIN+endpoint,{...options,headers:{'OAI-Sites-Authorization':'Bearer '+token,...options.headers},redirect:'error',signal:AbortSignal.timeout(15000)});
  const type=response.headers.get('content-type')||'';
  if(!response.ok&&(!type.includes('application/json')||response.status>=500))throw new Error('Backend unavailable');
  return response;
 }
 try{
  if(path==='/api/orders'&&request.method==='POST'){
   if(request.headers.get('origin')!==url.origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))return json({error:'Please submit this request from the store.'},403);
   if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'Send JSON data.'},415);
   // Reading is bounded by the Node entry point as well as the backend.
   const raw=await request.text();if(raw.length>50000)return json({error:'Request is too large.'},413);
   let body;try{body=JSON.stringify(JSON.parse(raw));}catch{return json({error:'Invalid request data.'},400);}
   const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)mdk-guest=([a-f0-9-]{36})\.([a-f0-9]{64})(?:;|$)/);
   const mac=value=>createHmac('sha256',secret).update(value).digest('hex');
   const visitor=cookie&&mac(cookie[1])===cookie[2]?cookie[1]:randomUUID();
   // On Vercel this platform header is overwritten at the edge. Hash it so
   // repeated cookie resets do not bypass the backend's request limit.
   const client=request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()||visitor;
   const guest=mac('order-client:'+client),timestamp=String(Date.now());
   const response=await upstream('/api/orders',{method:'POST',body,headers:{'Content-Type':'application/json',Origin:BACKEND_ORIGIN,'Sec-Fetch-Site':'same-origin','x-mdk-guest':guest,'x-mdk-time':timestamp,'x-mdk-signature':await signGuest(secret,guest,timestamp,body)}});
   const result=new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   result.headers.set('Set-Cookie',`mdk-guest=${visitor}.${mac(visitor)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);return result;
  }
  if(path.startsWith('/media/')){
   if(request.method!=='GET'||!/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(path))return json({error:'Image not found.'},404);
   const response=await upstream(path);return new Response(response.body,{status:response.status,headers:{'Content-Type':response.headers.get('content-type')||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }
  if(path.startsWith('/api/')&&path!=='/api/catalog')return json({error:'Page not found.'},404);
  if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
  let data;
  const load=async()=>{if(!data){const response=await upstream('/api/catalog');if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Invalid catalogue');data=await response.json();if(!Array.isArray(data))throw new Error('Invalid catalogue');}return data;};
  if(path==='/api/catalog')return json(await load(),200);
  // Strip all inbound headers before invoking the shared renderer. Admin
  // identity remains exclusively owned by the private Sites deployment.
  return await route(new Request(url,{method:request.method}),{CATALOGUE:load})||json({error:'Page not found.'},404);
 }catch{return json({error:'The store is temporarily unavailable. Please try again shortly.'},503);}
}

export default async function handler(req,res){
 try{
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
  const host=headers.get('host');if(!host||!/^[-a-z0-9.:]+$/i.test(host))throw new Error('Invalid host');
  if(!req.url?.startsWith('/')||req.url.startsWith('//'))throw new Error('Invalid path');
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(req.url?.startsWith('/api/admin/upload')?4*1024*1024:50000)){res.statusCode=413;res.end('Request is too large.');return;}chunks.push(chunk);}
  const request=new Request('https://'+host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await storefront(request);res.statusCode=response.status;response.headers.forEach((value,key)=>{if(key!=='set-cookie')res.setHeader(key,value);});
  const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
  res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=400;res.end('Invalid request.');}
}
