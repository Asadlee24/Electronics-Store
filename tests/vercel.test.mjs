import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {storefront,BACKEND_ORIGIN} from '../deployment/vercel.mjs';
import {api} from '../server/api.mjs';
import {catalogue} from '../server/catalogue.mjs';
import {signGuest} from '../server/gateway-auth.mjs';
const secret='local-test-key-only-'.repeat(3);
const env={MDK_SITES_SERVICE_TOKEN:'local-test-token',STOREFRONT_GATEWAY_SECRET:secret};
const request=(path,method='GET',body,headers={})=>new Request('https://shop.test'+path,{method,headers:{...headers,...(method==='POST'?{Origin:'https://shop.test','Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
function backend(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../drizzle/0000_glorious_leo.sql',import.meta.url),'utf8'));
 sqlite.exec(fs.readFileSync(new URL('../drizzle/0001_slow_warhawk.sql',import.meta.url),'utf8'));sqlite.exec(fs.readFileSync(new URL('../drizzle/0002_hesitant_medusa.sql',import.meta.url),'utf8'));
 const DB={prepare(sql){
  const stmt=sqlite.prepare(sql);let args=[];
  return{
   bind(...values){args=values;return this;},
   async all(){return{results:stmt.all(...args)};},
   async first(){return stmt.get(...args)||null;},
   async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}
  };
 }};
 const runtime={DB,ADMIN_EMAIL:'owner@example.test',STOREFRONT_GATEWAY_SECRET:secret};
 const calls=[];const fetcher=async(url,options)=>{assert.ok(url.startsWith(BACKEND_ORIGIN+'/'));assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer local-test-token');calls.push({url,options});return api(new Request(url,options),runtime);};
 return{runtime,fetcher,calls,sqlite};
}
const order=()=>({requestId:crypto.randomUUID(),items:[{id:737,quantity:1}],details:{name:'Local test',phone:'03140000000',address:'Test street',city:'Peshawar'},consent:true});
test('Vercel serves the current backend catalogue, including drafts and price edits',async()=>{
 const b=backend(),p=(await catalogue(b.runtime.DB)).find(p=>p.id===737);
 b.sqlite.prepare('INSERT INTO catalogue_products VALUES (?,?,?,1,?,?)').run(p.id,p.slug,JSON.stringify({...p,price:3210,active:true}),new Date().toISOString(),'test');
 let r=await storefront(request('/product/hikvision-2mp-camera/'),env,b.fetcher);assert.equal(r.status,200);assert.match(await r.text(),/Rs\. 3,210/);
 b.sqlite.prepare('UPDATE catalogue_products SET payload=? WHERE id=?').run(JSON.stringify({...p,active:false}),p.id);
 r=await storefront(request('/product/hikvision-2mp-camera/'),env,b.fetcher);assert.equal(r.status,404);
 const list=await (await storefront(request('/api/catalog'),env,b.fetcher)).json();assert.equal(list.some(p=>p.id===737),false);b.sqlite.close();
});
test('Vercel checkout persists a guest request once using backend prices and enforces rate limits',async()=>{
 const b=backend(),input=order(),headers={'x-vercel-forwarded-for':'192.0.2.20'};
 const r=await storefront(request('/api/orders','POST',input,headers),env,b.fetcher);assert.equal(r.status,201);const result=await r.json();assert.match(result.whatsappUrl,/wa.me/);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const duplicate=await storefront(request('/api/orders','POST',input,headers),env,b.fetcher);assert.equal((await duplicate.json()).reference,result.reference);
 const row=b.sqlite.prepare('SELECT * FROM order_requests').get();assert.equal(JSON.parse(row.payload).subtotal,3000);assert.match(row.owner_id,/^guest:/);
 for(let i=0;i<4;i++)assert.equal((await storefront(request('/api/orders','POST',order(),headers),env,b.fetcher)).status,201);
 assert.equal((await storefront(request('/api/orders','POST',order(),headers),env,b.fetcher)).status,429);b.sqlite.close();
});
test('public Vercel gateway cannot forward admin actions, visitor identity or arbitrary paths',async()=>{
 const b=backend();let r=await storefront(request('/admin/'),env,b.fetcher);assert.equal(r.status,503);assert.match(await r.text(),/owner connection/);
 r=await storefront(request('/api/admin/products','POST',{}, {'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}),env,b.fetcher);assert.equal(r.status,503);assert.equal(b.calls.length,0);
 assert.equal((await storefront(request('/api/private'),env,b.fetcher)).status,404);
 const req=request('/api/orders','POST',order());req.headers.set('origin','https://other.test');assert.equal((await storefront(req,env,b.fetcher)).status,403);assert.equal(b.calls.length,0);b.sqlite.close();
});
test('backend rejects unsigned, expired and body-tampered guest requests',async()=>{
 const b=backend(),id='a'.repeat(64),input=order(),timestamp=String(Date.now()),body=JSON.stringify(input);
 const base={Origin:BACKEND_ORIGIN,'Content-Type':'application/json','x-mdk-guest':id,'x-mdk-time':timestamp};
 const submit=(data,headers)=>api(new Request(BACKEND_ORIGIN+'/api/orders',{method:'POST',headers,body:JSON.stringify(data)}),b.runtime);
 assert.equal((await submit(input,base)).status,401);
 const signature=await signGuest(secret,id,timestamp,body);
 assert.equal((await submit({...input,items:[{id:737,quantity:2}]},{...base,'x-mdk-signature':signature})).status,401);
 const old=String(Date.now()-600000);assert.equal((await submit(input,{...base,'x-mdk-time':old,'x-mdk-signature':await signGuest(secret,id,old,body)})).status,401);
 assert.equal(b.sqlite.prepare('SELECT count(*) as count FROM order_requests').get().count,0);b.sqlite.close();
});
test('standalone mode serves local catalogue gracefully when backend configuration is absent',async()=>{
 const standalone=await storefront(request('/'),{});
 assert.equal(standalone.status,200);
 assert.match(await standalone.text(),/MDK Electronics/);
 const cat=await storefront(request('/api/catalog'),{});
 assert.equal(cat.status,200);
 const products=await cat.json();
 assert.ok(Array.isArray(products)&&products.length>=9);
 const r=await storefront(request('/'),env,async()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/local-test-token/);
});
