import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {storefront,BACKEND_ORIGIN,adminSessionCookies} from '../deployment/vercel.mjs';
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
test('browser login keeps the host-only session separate from private edge cookies',async()=>{
 const f=fixture();f.seed();
 const submit=new Request(origin+'/admin/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:owner,password})});
 const response=await storefront(submit,f.env,async(url,options)=>{
  const result=await route(new Request(url,options),f.backend);
  const headers=new Headers(result.headers);
  // Model both separate and folded Set-Cookie headers from an edge proxy.
  headers.set('Set-Cookie','edge_session=test; Path=/; Domain=.chatgpt.site; Expires=Wed, 21 Oct 2026 07:28:00 GMT, '+headers.get('set-cookie')+', edge_bot=test; Path=/; Domain=.chatgpt.site');
  return new Response(result.body,{status:result.status,headers});
 });
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/admin/');
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,1);assert.match(cookies[0],/^__Host-store_admin=[a-f0-9]{64};/);assert.doesNotMatch(cookies[0],/Domain=|edge_|,/);
 const cookie=cookies[0].split(';')[0];
 const dashboard=await f.call('/admin/',{cookie});assert.match(await dashboard.text(),/id="admin-main"/);
 assert.equal((await f.call('/api/admin/me',{cookie})).status,200);
 const separate=new Headers();separate.append('Set-Cookie','edge=test; Domain=.chatgpt.site');separate.append('Set-Cookie',cookies[0]);assert.deepEqual(adminSessionCookies(separate),cookies);
 assert.deepEqual(adminSessionCookies(new Headers({'Set-Cookie':'__Host-store_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'})),['__Host-store_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0']);
 f.sqlite.close();
});
test('custom domain renders the branded password form and rejects anonymous admin reads',async()=>{
 const f=fixture();const response=await f.call('/admin/');assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'same-origin');const html=await response.text();assert.match(html,/Welcome back/);assert.match(html,/autocomplete="current-password"/);assert.match(html,/images\/logo.png/);assert.doesNotMatch(html,/Sign in with ChatGPT/);
 assert.equal((await f.call('/api/admin/products',{headers:{'oai-authenticated-user-email':owner,'oai-authenticated-user-id':'spoof'}})).status,401);f.sqlite.close();
});
test('recovery pages preserve same-origin form submissions and reject opaque or foreign origins',async()=>{
 const f=fixture();f.seed();
 for(const path of ['/admin/forgot','/admin/reset?token='+'a'.repeat(64)]){
  const response=await f.call(path);assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'same-origin');
 }
 for(const source of ['null','https://other.test']){
  const req=new Request(origin+'/admin/request-reset',{method:'POST',headers:{Origin:source,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:owner})});
  assert.equal((await storefront(req,f.env)).status,403);
 }
 const before=f.sqlite.prepare('SELECT password_hash FROM admin_credentials WHERE id=1').get().password_hash;
 const forged=await f.call('/admin/reset',{form:{token:'f'.repeat(64),password:'some guessed private password',confirm:'some guessed private password'}});
 assert.equal(forged.status,400);assert.equal(f.sqlite.prepare('SELECT password_hash FROM admin_credentials WHERE id=1').get().password_hash,before);
 const other=await f.call('/admin/request-reset',{form:{email:'not-the-owner@example.test'}});assert.equal(other.status,200);assert.equal(f.messages.length,0);f.sqlite.close();
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
test('email templates include the store logo and escape customer data',()=>{
 const email=orderEmail(order);assert.match(email.html,/Buyer &lt;test&gt;/);assert.match(email.html,/https:\/\/mdkelectronics.com\/images\/logo.png/);assert.doesNotMatch(email.html,/<svg|<script/);assert.match(email.text,/No payment|not confirmed/);assert.match(email.html,/No payment has been taken/);assert.ok(email.html.length<102400);
 const reset=passwordEmail(origin+'/admin/reset?token='+'0'.repeat(64));assert.match(reset.text,/15 minutes/);assert.throws(()=>passwordEmail('https://evil.test/admin/reset'),/Invalid recovery/);
});
test('transactional outbox sends once and retries provider failures with the same idempotency key',async()=>{
 const f=fixture();await queueOrderEmails(f.backend,order,'test-1');await queueOrderEmails(f.backend,order,'test-1');await flushEmails(f.backend);assert.equal(f.messages.length,2);await flushEmails(f.backend);assert.equal(f.messages.length,2);assert.equal(f.sqlite.prepare("SELECT count(*) as count FROM email_outbox WHERE status='accepted'").get().count,2);
 await queueOrderEmails(f.backend,order,'test-2');const original=f.backend.MAIL_FETCH;f.backend.MAIL_FETCH=async()=>new Response('{}',{status:503});await flushEmails(f.backend);assert.equal(f.sqlite.prepare("SELECT count(*) as count FROM email_outbox WHERE status='failed'").get().count,2);f.sqlite.prepare('UPDATE email_outbox SET next_attempt=0').run();f.backend.MAIL_FETCH=original;await flushEmails(f.backend);assert.equal(f.messages.length,4);assert.ok(f.messages.every(x=>x.key.startsWith('store-order-test-')));f.sqlite.close();
});
test('only a signed-in owner with their current password can change mail settings',async()=>{
 const f=fixture();f.seed();const cookie=await login(f),settings={fromName:'Client Store',fromEmail:'orders@mdkelectronics.com',replyTo:'support@example.test',notificationEmail:'client@example.test',currentPassword:password};
 assert.equal((await f.call('/api/admin/mail/settings',{method:'POST',body:settings})).status,401);
 assert.equal((await f.call('/api/admin/mail/settings',{method:'POST',cookie,body:{...settings,currentPassword:'wrong'}})).status,401);
 assert.equal((await f.call('/api/admin/mail/settings',{method:'POST',cookie,body:{...settings,fromEmail:'other@unverified.test'}})).status,400);
 assert.equal((await f.call('/api/admin/mail/settings',{method:'POST',cookie,body:{...settings,replyTo:'hello@example.test\r\nBcc: elsewhere@example.test'}})).status,400);
 const saved=await f.call('/api/admin/mail/settings',{method:'POST',cookie,body:settings});assert.equal(saved.status,200,await saved.clone().text());
 const test=await f.call('/api/admin/mail/test',{method:'POST',cookie,body:{}});assert.equal(test.status,200);assert.deepEqual(f.messages[0].body.to,['client@example.test']);assert.equal(f.messages[0].body.from,'Client Store <orders@mdkelectronics.com>');assert.equal(f.messages[0].body.reply_to,'support@example.test');
 const report=await(await f.call('/api/admin/mail',{cookie})).json();assert.equal(report.ownerEmail,owner);assert.equal(report.notificationEmail,'client@example.test');assert.equal(report.recent[0].purpose,'test');assert.equal(report.recent[0].status,'accepted');assert.doesNotMatch(JSON.stringify(report),/test-mail-key|currentPassword|password_hash/);f.sqlite.close();
});
test('client owner handover requires reauthentication and inbox confirmation, then revokes old sessions and reset links',async()=>{
 const f=fixture();f.seed();const cookie=await login(f),email='client-owner@example.test';
 await f.call('/admin/request-reset',{form:{email:owner}});const oldReset=new URL(f.messages[0].body.text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token');
 assert.equal((await f.call('/api/admin/owner-email',{method:'POST',body:{email,currentPassword:password}})).status,401);
 assert.equal((await f.call('/api/admin/owner-email',{method:'POST',cookie,body:{email,currentPassword:'wrong'}})).status,401);
 const result=await f.call('/api/admin/owner-email',{method:'POST',cookie,body:{email,currentPassword:password}});assert.equal(result.status,200,await result.clone().text());
 assert.equal(f.sqlite.prepare('SELECT owner_email FROM admin_credentials').get().owner_email,null);
 const message=f.messages.find(m=>m.body.subject==='Verify your store owner email');assert.deepEqual(message.body.to,[email]);const token=new URL(message.body.text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token');
 const raw=f.sqlite.prepare('SELECT pending_email_hash FROM admin_credentials').get().pending_email_hash;assert.equal(raw,await digest(token));assert.notEqual(raw,token);
 assert.equal((await f.call('/admin/verify-email',{form:{token:'a'.repeat(64)}})).status,400);
 const confirm=await f.call('/admin/verify-email',{form:{token}});assert.equal(confirm.status,303,await confirm.clone().text());assert.equal(f.sqlite.prepare('SELECT owner_email FROM admin_credentials').get().owner_email,email);
 assert.equal((await f.call('/api/admin/me',{cookie})).status,401);assert.equal((await f.call('/admin/verify-email',{form:{token}})).status,400);
 assert.equal((await f.call('/admin/reset',{form:{token:oldReset,password,confirm:password}})).status,400);
 assert.equal((await f.call('/admin/login',{form:{email:owner,password}})).status,401);
 assert.equal((await f.call('/admin/login',{form:{email,password}})).status,401);
 const before=f.messages.length;await f.call('/admin/request-reset',{form:{email:owner}});assert.equal(f.messages.length,before);await f.call('/admin/request-reset',{form:{email}});assert.equal(f.messages.length,before+1);assert.deepEqual(f.messages.at(-1).body.to,[email]);const fresh=new URL(f.messages.at(-1).body.text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token');
 const next='the client private password';assert.equal((await f.call('/admin/reset',{form:{token:fresh,password:next,confirm:next}})).status,303);assert.equal((await f.call('/admin/login',{form:{email,password:next}})).status,303);f.sqlite.close();
});
test('cancelling handover invalidates its link and provider errors remain visible without secrets',async()=>{
 const f=fixture();f.seed();const cookie=await login(f);
 await f.call('/api/admin/owner-email',{method:'POST',cookie,body:{email:'client@example.test',currentPassword:password}});const token=new URL(f.messages[0].body.text.match(/https:\/\/[^\s]+/)[0]).searchParams.get('token');
 assert.equal((await f.call('/api/admin/owner-email/cancel',{method:'POST',cookie,body:{}})).status,200);assert.equal((await f.call('/admin/verify-email',{form:{token}})).status,400);
 f.backend.MAIL_FETCH=async()=>Response.json({name:'validation_error',message:'private provider response must not be shown'},{status:403});
 const response=await f.call('/api/admin/mail/test',{method:'POST',cookie,body:{}});assert.equal(response.status,503);const report=await(await f.call('/api/admin/mail',{cookie})).json();assert.ok(report.recent.some(m=>m.status==='failed'&&m.last_error==='Email provider error 403 (validation_error)'));assert.doesNotMatch(JSON.stringify(report),/test-mail-key|private provider/);f.sqlite.close();
});
test('new requests and status updates email the configured store inbox and customer once',async()=>{
 const f=fixture();f.seed();const cookie=await login(f);
 await f.call('/api/admin/mail/settings',{method:'POST',cookie,body:{fromName:'Store',fromEmail:'orders@mdkelectronics.com',notificationEmail:'client@example.test',replyTo:'support@example.test',currentPassword:password}});
 const id=crypto.randomUUID(),input={requestId:id,items:[{id:737,quantity:1}],details:{name:'Test customer',phone:'03140000000',email:'buyer@example.test',address:'Test street',city:'Peshawar'},consent:true};
 const saved=await f.call('/api/orders',{method:'POST',body:input});assert.equal(saved.status,201,await saved.clone().text());assert.equal(f.messages.length,2);assert.deepEqual(f.messages.map(m=>m.body.to[0]).sort(),['buyer@example.test','client@example.test']);
 const status={id,revision:1,status:'dispatched'};assert.equal((await f.call('/api/admin/orders',{method:'PATCH',cookie,body:status})).status,200);assert.equal(f.messages.length,4);assert.match(f.messages[2].body.subject,/dispatched/);assert.doesNotMatch(f.messages[2].body.html,/Pending confirmation/);
 assert.equal((await f.call('/api/admin/orders',{method:'PATCH',cookie,body:{...status,revision:2}})).status,200);assert.equal(f.messages.length,4);f.sqlite.close();
});
test('hosting-owner recovery is applied once, clears the old lock by revision and revokes sessions',async()=>{
 const f=fixture();f.seed();const cookie=await login(f);for(let i=0;i<8;i++)await f.call('/admin/login',{form:{email:owner,password:'wrong'}});
 assert.equal((await f.call('/admin/login',{form:{email:owner,password}})).status,429);
 const next='ownerTest1!',hash=await hashPassword(next),id='c'.repeat(64);Object.assign(f.backend,{ADMIN_RECOVERY_ID:id,ADMIN_RECOVERY_PASSWORD_HASH:hash,ADMIN_RECOVERY_EMAIL:'someone@example.test'});
 await f.call('/admin/');assert.equal(f.sqlite.prepare('SELECT revision FROM admin_credentials').get().revision,1);
 f.backend.ADMIN_RECOVERY_EMAIL=owner;await f.call('/admin/');await f.call('/admin/');const state=f.sqlite.prepare('SELECT revision,recovery_id,reset_hash FROM admin_credentials').get();assert.equal(state.revision,2);assert.equal(state.recovery_id,id);assert.equal(state.reset_hash,null);
 assert.equal((await f.call('/api/admin/me',{cookie})).status,401);assert.equal((await f.call('/admin/login',{form:{email:owner,password:next}})).status,303);
 delete f.backend.ADMIN_RECOVERY_ID;delete f.backend.ADMIN_RECOVERY_PASSWORD_HASH;delete f.backend.ADMIN_RECOVERY_EMAIL;
 assert.equal((await f.call('/admin/login',{form:{email:owner,password:next}})).status,303);assert.equal((await f.call('/admin/login',{form:{email:owner,password}})).status,401);f.sqlite.close();
});
test('confirmed product deletion hides imported items permanently and preserves order history',async()=>{
 const f=fixture();f.seed();const cookie=await login(f),input={id:737,revision:0,confirm:true};
 const order={requestId:crypto.randomUUID(),items:[{id:737,quantity:1}],details:{name:'Customer',phone:'03140000000',address:'Test street',city:'Peshawar'},consent:true};await f.call('/api/orders',{method:'POST',body:order});
 assert.equal((await f.call('/api/admin/products/delete',{method:'POST',body:input})).status,401);
 assert.equal((await f.call('/api/admin/products/delete',{method:'POST',cookie,body:{...input,confirm:false}})).status,400);
 assert.equal((await f.call('/api/admin/products/delete',{method:'POST',cookie,body:{...input,revision:99}})).status,409);
 assert.equal((await f.call('/api/admin/products/delete',{method:'POST',cookie,body:input})).status,200);
 const publicList=await(await f.call('/api/catalog')).json(),adminList=await(await f.call('/api/admin/products',{cookie})).json();assert.equal(publicList.some(p=>p.id===737),false);assert.equal(adminList.products.some(p=>p.id===737),false);
 assert.equal((await f.call('/product/hikvision-2mp-camera/')).status,404);assert.equal((await f.call('/api/admin/products/delete',{method:'POST',cookie,body:input})).status,404);
 const history=await(await f.call('/api/admin/orders',{cookie})).json();assert.equal(history.orders[0].items[0].id,737);assert.equal(history.orders[0].subtotal,3000);assert.equal(JSON.parse(f.sqlite.prepare('SELECT payload FROM catalogue_products WHERE id=737').get().payload).deleted,true);f.sqlite.close();
});
const contactInput=()=>({requestId:crypto.randomUUID(),name:'Contact customer',email:'visitor@example.test',phone:'03140000000',subject:'Product enquiry',message:'Please share the details for this camera. <script>not executable</script>',consent:true,website:''});
test('public contact form saves once, emails only the store and appears in protected Messages',async()=>{
 const f=fixture();f.seed();const cookie=await login(f),input=contactInput();const page=await f.call('/contact-us/');assert.match(await page.text(),/id="contact-form"/);
 const response=await f.call('/api/contact',{method:'POST',body:input});assert.equal(response.status,201,await response.clone().text());const data=await response.json();assert.match(data.reference,/^MDK-M-/);assert.equal(data.saved,true);assert.equal(f.messages.length,1);assert.deepEqual(f.messages[0].body.to,[owner]);assert.equal(f.messages[0].body.reply_to,input.email);assert.match(f.messages[0].body.html,/&lt;script&gt;/);assert.doesNotMatch(f.messages[0].body.html,/<script>/);
 const again=await(await f.call('/api/contact',{method:'POST',body:input})).json();assert.equal(again.reference,data.reference);assert.equal(f.messages.length,1);assert.equal(f.sqlite.prepare('SELECT count(*) as n FROM contact_messages').get().n,1);
 assert.equal((await f.call('/api/contact',{method:'POST',body:{...input,message:'A different message with the same id'}})).status,409);
 assert.equal((await f.call('/api/admin/messages')).status,401);const list=await(await f.call('/api/admin/messages',{cookie})).json();assert.equal(list.messages[0].message,input.message);assert.equal(list.messages[0].email,input.email);f.sqlite.close();
});
test('contact validation and persistent spam limits do not send messages to arbitrary recipients',async()=>{
 const f=fixture();const input=contactInput();for(const patch of [{email:'bad-email'},{consent:false},{message:'short'},{phone:'not-a-phone'}])assert.equal((await f.call('/api/contact',{method:'POST',body:{...input,...patch}})).status,400);
 assert.equal((await f.call('/api/contact',{method:'POST',body:{...input,website:'bot.example'}})).status,201);assert.equal(f.messages.length,0);assert.equal(f.sqlite.prepare('SELECT count(*) as n FROM contact_messages').get().n,0);
 for(let i=0;i<3;i++)assert.equal((await f.call('/api/contact',{method:'POST',body:contactInput()})).status,201);
 assert.equal((await f.call('/api/contact',{method:'POST',body:contactInput()})).status,429);assert.equal(f.messages.length,3);assert.ok(f.messages.every(m=>m.body.to.length===1&&m.body.to[0]===owner));f.sqlite.close();
});
test('contact signatures are scoped separately from orders and failed mail remains retryable',async()=>{
 const {signGuest}=await import('../server/gateway-auth.mjs');const f=fixture(),input=contactInput(),body=JSON.stringify(input),time=String(Date.now()),id='a'.repeat(64);
 const headers={Origin:BACKEND_ORIGIN,'Content-Type':'application/json','x-mdk-guest':id,'x-mdk-time':time,'x-mdk-signature':await signGuest(f.backend.STOREFRONT_GATEWAY_SECRET,id,time,body)};
 assert.equal((await route(new Request(BACKEND_ORIGIN+'/api/contact',{method:'POST',headers,body}),f.backend)).status,401);
 headers['x-mdk-signature']=await signGuest(f.backend.STOREFRONT_GATEWAY_SECRET,id,time,'contact\n'+body);assert.equal((await route(new Request(BACKEND_ORIGIN+'/api/orders',{method:'POST',headers,body}),f.backend)).status,401);
 const original=f.backend.MAIL_FETCH;f.backend.MAIL_FETCH=async()=>Response.json({name:'rate_limit_exceeded'},{status:429});assert.equal((await f.call('/api/contact',{method:'POST',body:input})).status,201);assert.equal(f.sqlite.prepare("SELECT count(*) as n FROM email_outbox WHERE status='failed'").get().n,1);f.sqlite.prepare('UPDATE email_outbox SET next_attempt=0').run();f.backend.MAIL_FETCH=original;await flushEmails(f.backend);assert.equal(f.messages.length,1);assert.equal(f.sqlite.prepare("SELECT count(*) as n FROM email_activity WHERE purpose='contact' AND status='accepted'").get().n,1);f.sqlite.close();
});

test('homepage slides persist owner edits with revision checks and hide unpublished products',async()=>{
 const f=fixture();f.seed();assert.equal((await f.call('/api/admin/hero')).status,401);
 const initial=await(await f.call('/api/hero')).json();assert.equal(initial.slides.length,6);assert.deepEqual(initial.slides.slice(0,3).map(s=>s.productId),[1001,1002,1003]);
 const cookie=await login(f);const slides=[...initial.slides].reverse();slides[0].enabled=false;slides[1].kicker='Owner selection';
 const saved=await f.call('/api/admin/hero',{cookie,method:'POST',body:{slides,revision:initial.revision}});assert.equal(saved.status,200);const config=await saved.json();assert.equal(config.revision,1);
 assert.deepEqual((await(await f.call('/api/hero')).json()).slides,slides);
 assert.equal((await f.call('/api/admin/hero',{cookie,method:'POST',body:initial})).status,409);
 assert.equal((await f.call('/api/admin/hero',{cookie,method:'POST',body:{slides:slides.map(s=>({...s,image:'https://evil.test/a.png'})),revision:1}})).status,400);
 assert.equal((await f.call('/api/admin/hero',{cookie,method:'POST',body:{slides:slides.map(s=>({...s,enabled:false})),revision:1}})).status,400);
 const page=await(await f.call('/')).text();assert.match(page,/Owner selection/);assert.doesNotMatch(page,/data-slide="571"/);
 const all=await(await f.call('/api/admin/products',{cookie})).json();const p=all.products.find(p=>p.id===1002);
 f.sqlite.prepare('INSERT INTO catalogue_products (id,slug,payload,revision,updated_at,updated_by) VALUES (?,?,?,1,?,?)').run(p.id,p.slug,JSON.stringify({...p,active:false}),new Date().toISOString(),'test');
 assert.doesNotMatch(await(await f.call('/')).text(),/data-slide="1002"/);f.sqlite.close();
});

const testProof=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');
function paymentBucket(f){const objects=new Map();f.backend.BUCKET={async put(key,bytes,options){objects.set(key,{bytes:Buffer.from(bytes),options})},async get(key){const item=objects.get(key);return item?{body:item.bytes,arrayBuffer:async()=>Uint8Array.from(item.bytes).buffer}:null}};return objects}
const bankOrder=()=>({requestId:crypto.randomUUID(),items:[{id:737,quantity:1}],details:{name:'Test payment buyer',phone:'03140000000',email:'buyer@example.test',address:'Local test address',city:'Peshawar'},payment:{method:'bank',proof:testProof.toString('base64'),senderName:'Test sender',transactionRef:'TEST-ONLY-123'},consent:true});
test('bank proof remains private, emails the owner as an attachment and awaits admin review',async()=>{
 const f=fixture();f.seed();const objects=paymentBucket(f),input=bankOrder();
 const response=await f.call('/api/orders',{method:'POST',body:input});assert.equal(response.status,201,await response.clone().text());const saved=await response.json();assert.equal(saved.paymentStatus,'under_review');assert.equal(saved.proofReceived,true);assert.doesNotMatch(JSON.stringify(saved),/payment-proofs|base64/);
 assert.equal(objects.size,1);assert.equal(f.messages.length,2);const ownerMail=f.messages.find(m=>m.body.to.includes(owner)),customerMail=f.messages.find(m=>m.body.to.includes(input.details.email));assert.equal(ownerMail.body.attachments.length,1);assert.equal(ownerMail.body.attachments[0].content,testProof.toString('base64'));assert.equal(customerMail.body.attachments,undefined);assert.equal(ownerMail.body.proofAttachment,undefined);assert.match(ownerMail.body.text,/1522218691001960/);assert.match(ownerMail.body.html,/Nasir Ahmed/);assert.match(ownerMail.body.html,/images\/logo.png/);
 await f.call('/api/orders',{method:'POST',body:input});assert.equal(objects.size,1);assert.equal(f.messages.length,2);
 assert.equal((await f.call('/api/admin/payment-proof/'+input.requestId)).status,401);
 assert.equal((await f.call('/media/payment-proofs/'+input.requestId)).status,404);
 assert.equal((await f.call('/api/admin/payments',{method:'PATCH',body:{id:input.requestId,revision:1,status:'verified'}})).status,401);
 const cookie=await login(f);const proof=await f.call('/api/admin/payment-proof/'+input.requestId,{cookie});assert.equal(proof.status,200);assert.match(proof.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await proof.arrayBuffer()),testProof);
 let order=(await(await f.call('/api/admin/orders',{cookie})).json()).orders[0];assert.equal(order.payment.status,'under_review');assert.equal(order.status,'pending');assert.equal(order.payment.bank.accountTitle,'Nasir Ahmed');
 const review=await f.call('/api/admin/payments',{cookie,method:'PATCH',body:{id:input.requestId,revision:1,status:'verified',note:'Transfer checked. <script>not markup</script>'}});assert.equal(review.status,200);assert.equal(f.messages.length,4);assert.match(f.messages.at(-1).body.subject,/Payment verified/);assert.match(f.messages.at(-1).body.html,/&lt;script&gt;/);assert.doesNotMatch(f.messages.at(-1).body.html,/<script>/);
 order=(await(await f.call('/api/admin/orders',{cookie})).json()).orders[0];assert.equal(order.paymentStatus,'verified');assert.equal(order.status,'pending');assert.equal(order.revision,2);
 assert.equal((await f.call('/api/admin/payments',{cookie,method:'PATCH',body:{id:input.requestId,revision:1,status:'rejected'}})).status,409);f.sqlite.close();
});
test('bank proof validation rejects missing, oversized, non-image and unavailable uploads before saving orders',async()=>{
 const f=fixture();f.seed();const objects=paymentBucket(f);
 for(const payment of [{method:'bank'},{method:'bank',proof:Buffer.from('<svg>invalid image</svg>').toString('base64')},{method:'bank',proof:'A'.repeat(2800000)},{method:'unknown'}]){const r=await f.call('/api/orders',{method:'POST',body:{...bankOrder(),payment}});assert.equal(r.status,400,await r.clone().text())}
 const missingEmail=bankOrder();missingEmail.details.email='';assert.equal((await f.call('/api/orders',{method:'POST',body:missingEmail})).status,400);assert.equal(objects.size,0);assert.equal(f.sqlite.prepare('SELECT count(*) as count FROM order_requests').get().count,0);
 delete f.backend.BUCKET;assert.equal((await f.call('/api/orders',{method:'POST',body:bankOrder()})).status,503);assert.equal(f.messages.length,0);f.sqlite.close();
});
test('bank proof email retries read private storage and do not duplicate notifications',async()=>{
 const f=fixture();f.seed();paymentBucket(f);let fail=true;f.backend.MAIL_FETCH=async(url,options)=>{if(fail)return Response.json({name:'rate_limit_exceeded'},{status:429});f.messages.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({id:'payment-mail-test'})};
 const input=bankOrder();assert.equal((await f.call('/api/orders',{method:'POST',body:input})).status,201);assert.equal(f.sqlite.prepare("SELECT count(*) as count FROM email_outbox WHERE status='failed'").get().count,2);
 fail=false;f.sqlite.prepare('UPDATE email_outbox SET next_attempt=0').run();await flushEmails(f.backend);assert.equal(f.messages.length,2);assert.equal(f.messages.find(m=>m.body.to.includes(owner)).body.attachments.length,1);await flushEmails(f.backend);assert.equal(f.messages.length,2);f.sqlite.close();
});
test('rejected payment notifies customer without changing fulfilment or accepting a second review twice',async()=>{
 const f=fixture();f.seed();paymentBucket(f);const input=bankOrder();await f.call('/api/orders',{method:'POST',body:input});const cookie=await login(f);
 const patch={id:input.requestId,revision:1,status:'rejected',note:'Transfer not found. Contact the store.'};assert.equal((await f.call('/api/admin/payments',{cookie,method:'PATCH',body:patch})).status,200);assert.match(f.messages.at(-1).body.subject,/Payment rejected/);
 const order=(await(await f.call('/api/admin/orders',{cookie})).json()).orders[0];assert.equal(order.paymentStatus,'rejected');assert.equal(order.status,'pending');assert.equal((await f.call('/api/admin/payments',{cookie,method:'PATCH',body:patch})).status,409);assert.equal(f.messages.length,4);f.sqlite.close();
});
