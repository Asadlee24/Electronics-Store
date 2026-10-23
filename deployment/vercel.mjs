import {createHmac,randomUUID} from 'node:crypto';
import {route} from '../server/router.mjs';
import {signGuest} from '../server/gateway-auth.mjs';

// The browser can reach only these public backend operations. Never forward
// visitor cookies, identity headers, arbitrary URLs, or admin API requests.
export const BACKEND_ORIGIN='https://mdk-electronics-preview.asadaly416.chatgpt.site';
const json=(value,status)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function storefront(request,env=process.env,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname.replace(/\/$/,'')||'/';
 if(path==='/admin'||path.startsWith('/admin/'))return new Response(null,{status:302,headers:{Location:BACKEND_ORIGIN+'/admin/','Cache-Control':'no-store'}});
 if(path.startsWith('/api/admin'))return json({error:'Open the private store admin to manage products and orders.'},403);
 const token=env.MDK_SITES_SERVICE_TOKEN,secret=env.STOREFRONT_GATEWAY_SECRET;
 if(!token||!secret||secret.length<32)return json({error:'The store connection has not been configured yet.'},503);
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
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>50000){res.statusCode=413;res.end('Request is too large.');return;}chunks.push(chunk);}
  const request=new Request('https://'+host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await storefront(request);res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=400;res.end('Invalid request.');}
}
