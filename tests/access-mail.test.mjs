import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {storefront,BACKEND_ORIGIN} from '../deployment/vercel.mjs';
import {route} from '../server/router.mjs';
import {hashPassword,digest,adminGatewayHeaders} from '../server/admin-auth.mjs';
import {orderEmail,passwordEmail,queueOrderEmails,flushEmails} from '../server/emails.mjs';
const origin='https://www.mdkelectronics.com';
const owner='owner@example.test',password='a local test password 123';
const passwordHash=await hashPassword(password);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const DB={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return{bind(...values){args=values;return this},async all(){return{results:stmt.all(...args)}},async first(){return stmt.get(...args)||null},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}}}}}};
 const messages=[],backend={DB,ADMIN_EMAIL:owner,ADMIN_GATEWAY_SECRET:'test-admin-key-'.repeat(4),STOREFRONT_GATEWAY_SECRET:'test-guest-key-'.repeat(4),RESEND_API_KEY:'test-mail-key',MAIL_FETCH:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({id:crypto.randomUUID()});}};
 const env={MDK_SITES_SERVICE_TOKEN:'test-service-token',ADMIN_GATEWAY_SECRET:backend.ADMIN_GATEWAY_SECRET,STOREFRONT_GATEWAY_SECRET:backend.STOREFRONT_GATEWAY_SECRET};
 const fetcher=async(url,options)=>{assert.ok(url.startsWith(BACKEND_ORIGIN+'/'));assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer test-service-token');assert.equal(options.headers['oai-authenticated-user-email'],undefined);return route(new Request(url,options),backend);};
 const call=(path,{form,cookie,method,headers={},body}={})=>{const verb=method||(form?'POST':'GET');return storefront(new Request(origin+path,{method:verb,headers:{...headers,...(cookie?{cookie}:{}),...(!['GET','HEAD'].includes(verb)?{Origin:origin,'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),'x-vercel-forwarded-for':'192.0.2.5'},...(form?{body:new URLSearchParams(form).toString()}:body?{body:JSON.stringify(body)}:{})}),env,fetcher);};
 const seed=()=>sqlite.prepare('INSERT INTO admin_credentials (id,password_hash,revision) VALUES (1,?,1)').run(passwordHash);
 return{sqlite,backend,env,call,messages,seed};
}
async function login(f){const response=await f.call('/admin/login',{form:{email:owner,password}});assert.equal(response.status,303,await response.clone().text());return response.headers.get('set-cookie').split(';')[0];}
test('custom domain renders a logo-free password form and rejects anonymous admin reads',async()=>{
 const f=fixture();const response=await f.call('/admin/');assert.equal(response.status,200);const html=await response.text();assert.match(html,/Welcome back/);assert.match(html,/autocomplete="current-password"/);assert.doesNotMatch(html,/Sign in with ChatGPT|images\/logo|MDK Electronics/);
 assert.equal((await f.call('/api/admin/products',{headers:{'oai-authenticated-user-email':owner,'oai-authenticated-user-id':'spoof'}})).status,401);f.sqlite.close();
});
test('password login, actual product edits and logout work through the signed gateway',async()=>{
 const f=fixture();f.seed();const response=await f.call('/admin/login',{form:{email:owner,password:'wrong'}});assert.equal(response.status,401);
 const cookie=await login(f);assert.match(cookie,/__Host-store_admin=/);assert.equal((await f.call('/api/admin/me',{cookie})).status,200);
 const list=await(await f.call('/api/admin/products',{cookie})).json(),p=list.products.find(x=>x.id===737);
 const update=await f.call('/api/admin/products',{method:'POST',cookie,body:{id:p.id,revision:p.revision,name:p.name,slug:p.slug,category:p.categories[0],price:3450,regularPrice:3500,inStock:true,active:true,images:p.images,description:'Local test',shortDescription:''}});assert.equal(update.status,200);
 const product=await f.call('/product/hikvision-2mp-camera/');assert.match(await product.text(),/Rs\. 3,450/);
 const logout=await f.call('/admin/logout',{cookie,form:{}});assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await f.call('/api/admin/me',{cookie})).status,401);f.sqlite.close();
});
test('email setup link is owner-only, single-use and revokes older sessions on password change',async()=>{
 const f=fixture();f.seed();const cookie=await login(f);
 let response=await f.call('/admin/request-reset',{form:{email:'other@example.test'}});assert.equal(response.status,200);assert.equal(f.messages.length,0);
 response=await f.call('/admin/request-reset',{form:{email:owner}});assert.equal(response.status,200,await response.clone().text());assert.equal(f.messages.length,1);assert.deepEqual(f.messages[0].body.to,[owner]);
 const link=f.messages[0].body.text.match(/https:\/\/[^\s]+/)[0],token=new URL(link).searchParams.get('token');assert.equal(new URL(link).origin,origin);assert.equal(f.sqlite.prepare('SELECT reset_hash FROM admin_credentials').get().reset_hash,await digest(token));
 const weak=await f.call('/admin/reset',{form:{token,password:'short',confirm:'short'}});assert.equal(weak.status,400);assert.match(await weak.text(),new RegExp(token));
 const next='another private test password';const changed=await f.call('/admin/reset',{form:{token,password:next,confirm:next}});assert.equal(changed.status,303,await changed.clone().text());assert.equal((await f.call('/api/admin/me',{cookie})).status,401);
 assert.equal((await f.call('/admin/reset',{form:{token,password:next,confirm:next}})).status,400);
 assert.equal((await f.call('/admin/login',{form:{email:owner,password:next}})).status,303);assert.equal((await f.call('/admin/login',{form:{email:owner,password}})).status,401);f.sqlite.close();
});
test('expired reset links and cross-origin form submissions do not change credentials',async()=>{
 const f=fixture();f.seed();const token='a'.repeat(64);f.sqlite.prepare('UPDATE admin_credentials SET reset_hash=?,reset_expires=?').run(await digest(token),Date.now()-1);
 assert.equal((await f.call('/admin/reset',{form:{token,password,confirm:password}})).status,400);
 const req=new Request(origin+'/admin/login',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:owner,password})});
 assert.equal((await storefront(req,f.env)).status,403);f.sqlite.close();
});
test('login attempt counters persist across requests',async()=>{
 const f=fixture();f.seed();for(let i=0;i<8;i++)assert.equal((await f.call('/admin/login',{form:{email:owner,password:'wrong'}})).status,401);assert.equal((await f.call('/admin/login',{form:{email:owner,password}})).status,429);f.sqlite.close();
});
test('gateway signatures bind the method, path, body, cookie and public origin',async()=>{
 const f=fixture();f.seed();const request=new Request(origin+'/api/admin/products',{method:'POST',headers:{cookie:'__Host-store_admin='+'a'.repeat(64)},body:'{}'}),headers=await adminGatewayHeaders(request,f.backend.ADMIN_GATEWAY_SECRET,'b'.repeat(64));
 const response=await route(new Request(BACKEND_ORIGIN+'/api/admin/products',{method:'POST',headers:{...headers,cookie:'__Host-store_admin='+'a'.repeat(64),Origin:BACKEND_ORIGIN,'Content-Type':'application/json'},body:'{"id":737}'}),f.backend);assert.equal(response.status,401);f.sqlite.close();
});
const order={reference:'TEST-ORDER',items:[{name:'Camera <test>',quantity:2,unitPrice:3000,total:6000}],subtotal:6000,customer:{name:'Buyer <test>',phone:'03140000000',city:'Peshawar',email:'buyer@example.test'}};
test('email templates escape customer data and explain pending payment without logo images',()=>{
 const email=orderEmail(order);assert.match(email.html,/Buyer &lt;test&gt;/);assert.doesNotMatch(email.html,/<img|<svg|<script|MDK Electronics/);assert.match(email.text,/No payment|not confirmed/);assert.match(email.html,/No payment has been taken/);assert.ok(email.html.length<102400);
 const reset=passwordEmail(origin+'/admin/reset?token='+'0'.repeat(64));assert.match(reset.text,/15 minutes/);assert.throws(()=>passwordEmail('https://evil.test/admin/reset'),/Invalid recovery/);
});
test('transactional outbox sends once and retries provider failures with the same idempotency key',async()=>{
 const f=fixture();await queueOrderEmails(f.backend,order,'test-1');await queueOrderEmails(f.backend,order,'test-1');await flushEmails(f.backend);assert.equal(f.messages.length,2);await flushEmails(f.backend);assert.equal(f.messages.length,2);assert.equal(f.sqlite.prepare("SELECT count(*) as count FROM email_outbox WHERE status='accepted'").get().count,2);
 await queueOrderEmails(f.backend,order,'test-2');const original=f.backend.MAIL_FETCH;f.backend.MAIL_FETCH=async()=>new Response('{}',{status:503});await flushEmails(f.backend);assert.equal(f.sqlite.prepare("SELECT count(*) as count FROM email_outbox WHERE status='failed'").get().count,2);f.sqlite.prepare('UPDATE email_outbox SET next_attempt=0').run();f.backend.MAIL_FETCH=original;await flushEmails(f.backend);assert.equal(f.messages.length,4);assert.ok(f.messages.every(x=>x.key.startsWith('store-order-test-')));f.sqlite.close();
});
