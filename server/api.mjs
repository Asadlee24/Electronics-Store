import {ApiError,identity,requireAdmin,requireSameOrigin,catalogue,validateProduct,validateOrder,imageType,orderMessage,STOCK_STATUSES} from './catalogue.mjs';
import {validatePayment,storePaymentProof,publicOrderResult} from './payments.mjs';
import {paymentReviewEmail} from './emails.mjs';
import {mailSettings as getPaymentMailSettings} from './mail-settings.mjs';
import {heroSettings,saveHero} from './hero.mjs';
import {saveContact} from './contact.mjs';
import {gatewayGuest} from './gateway-auth.mjs';
import {requireAdminSession,reauthenticate,requestOwnerEmailChange,limit} from './admin-auth.mjs';
import {mailSettings,saveMailSettings} from './mail-settings.mjs';
import {queueOrderEmails,queueStatusEmails,flushEmails,orderEmail,passwordEmail,sendEmail,verificationEmail,testEmail} from './emails.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readJSON(request,max=50000){if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'Send JSON data.');const body=await request.clone().text();if(body.length>max)throw new ApiError(413,'Request is too large.');try{const value=JSON.parse(body);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new ApiError(400,'Invalid request data.')}}
export async function api(request,env){
 const path=new URL(request.url).pathname.replace(/\/$/,'');
 if(!path.startsWith('/api/')&&!path.startsWith('/media/'))return null;
 try{
  if(path.startsWith('/media/')&&request.method==='GET'){
   if(!/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(path))throw new ApiError(404,'Image not found.');
   const object=await env.BUCKET?.get(path.slice(7));if(!object)throw new ApiError(404,'Image not found.');
   const headers=new Headers({'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});return new Response(object.body,{headers});
  }
  if(path==='/api/hero'&&request.method==='GET')return json(await heroSettings(env.DB));
  if(path==='/api/catalog'&&request.method==='GET')return json(await catalogue(env.DB));
  if(path.startsWith('/api/admin/')){
   const user=await requireAdminSession(request,env);
   if(request.method!=='GET')requireSameOrigin(request);
   if(path==='/api/admin/hero'&&request.method==='GET')return json(await heroSettings(env.DB));
   if(path==='/api/admin/hero'&&request.method==='POST')return json(await saveHero(env.DB,await readJSON(request),await catalogue(env.DB,{all:true})));
   if(path==='/api/admin/me'&&request.method==='GET')return json({email:user.email,canEdit:true});
   if(path==='/api/admin/products'&&request.method==='GET')return json({products:await catalogue(env.DB,{all:true})});
   if(path==='/api/admin/products'&&request.method==='POST'){
    const input=await readJSON(request);const products=await catalogue(env.DB,{all:true});
    const existing=input.id?products.find(p=>p.id===input.id):null;
    if(input.id&&!existing)throw new ApiError(404,'Product not found.');
    if(existing&&input.revision!==existing.revision)throw new ApiError(409,'This product changed in another session. Reload before saving.');
    const product=validateProduct(input,existing);
    const reserved=await env.DB.prepare('SELECT id FROM catalogue_products WHERE slug=?').bind(product.slug).first();
    if(reserved&&reserved.id!==existing?.id)throw new ApiError(409,'That URL belongs to an existing or deleted product. Choose another URL.');
    if(products.some(p=>p.slug===product.slug&&p.id!==existing?.id))throw new ApiError(409,'That product URL is already in use.');
    product.id=existing?.id||(100000+crypto.getRandomValues(new Uint32Array(1))[0]);
    const at=new Date().toISOString();
    const result=await env.DB.prepare('INSERT INTO catalogue_products (id,slug,payload,revision,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,payload=excluded.payload,revision=catalogue_products.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE catalogue_products.revision=?').bind(product.id,product.slug,JSON.stringify(product),at,user.id,existing?.revision||0).run();
    if(!result.meta.changes)throw new ApiError(409,'This product was changed elsewhere. Reload before saving.');
    return json({product:{...product,revision:(existing?.revision||0)+1}},existing?200:201);
   }
   if(path==='/api/admin/products/delete'&&request.method==='POST'){
    const input=await readJSON(request);if(!Number.isInteger(input.id)||!Number.isInteger(input.revision)||input.confirm!==true)throw new ApiError(400,'Confirm the product you want to delete.');
    const product=(await catalogue(env.DB,{all:true})).find(p=>p.id===input.id);if(!product)throw new ApiError(404,'Product not found.');
    if(product.revision!==input.revision)throw new ApiError(409,'This product changed. Reload before deleting.');
    const removed={...product,deleted:true,active:false,inStock:false};
    const result=await env.DB.prepare('INSERT INTO catalogue_products (id,slug,payload,revision,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=catalogue_products.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE catalogue_products.revision=?').bind(product.id,product.slug,JSON.stringify(removed),new Date().toISOString(),user.id,product.revision).run();
    if(!result.meta.changes)throw new ApiError(409,'This product changed. Reload before deleting.');return json({deleted:true});
   }
   if(path==='/api/admin/upload'&&request.method==='POST'){
    if(!env.BUCKET)throw new ApiError(503,'Photo storage is not available.');
    const length=Number(request.headers.get('content-length')||0);if(length>6*1024*1024)throw new ApiError(413,'Choose a photo smaller than 6 MB.');
    const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>6*1024*1024||bytes.length<20)throw new ApiError(413,'Choose a photo between 20 bytes and 6 MB.');
    const type=imageType(bytes);if(!type||request.headers.get('content-type')?.split(';')[0]!==type.mime)throw new ApiError(415,'Use a JPG, PNG or WebP photo.');
    const key=crypto.randomUUID()+'.'+type.extension;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type.mime}});return json({url:'/media/'+key},201);
   }
   if(path==='/api/admin/messages'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT id,reference,payload,created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100').all();return json({messages:(rows.results||[]).map(row=>({...JSON.parse(row.payload),id:row.id,reference:row.reference,createdAt:row.created_at}))});
   }
   if(path.startsWith('/api/admin/payment-proof/')&&request.method==='GET'){
    const id=path.slice('/api/admin/payment-proof/'.length);if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError(404,'Proof not found.');
    const row=await env.DB.prepare('SELECT reference,payload FROM order_requests WHERE id=?').bind(id).first();const proof=row&&JSON.parse(row.payload).payment?.proof;
    if(!proof)throw new ApiError(404,'Proof not found.');const object=await env.BUCKET?.get(proof.key);if(!object)throw new ApiError(404,'Proof not found.');
    return new Response(object.body,{headers:{'Content-Type':proof.mime,'Content-Disposition':`inline; filename="${row.reference}-proof.${proof.extension}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'self'; sandbox",'Referrer-Policy':'no-referrer'}});
   }
   if(path==='/api/admin/payments'&&request.method==='PATCH'){
    const input=await readJSON(request);if(!['verified','rejected'].includes(input.status)||typeof input.id!=='string'||!Number.isInteger(input.revision))throw new ApiError(400,'Choose a payment review result.');
    const row=await env.DB.prepare('SELECT reference,payload,revision FROM order_requests WHERE id=?').bind(input.id).first();if(!row)throw new ApiError(404,'Order not found.');if(row.revision!==input.revision)throw new ApiError(409,'The order changed. Reload before reviewing.');
    const order=JSON.parse(row.payload);if(order.payment?.method!=='bank'||!order.payment.proof)throw new ApiError(400,'This order has no bank transfer proof.');
    if(order.payment.status===input.status)return json({saved:true});
    const note=typeof input.note==='string'?input.note.trim():'';if(note.length>500)throw new ApiError(400,'Use a review note under 500 characters.');
    order.payment={...order.payment,status:input.status,reviewNote:note,reviewedAt:new Date().toISOString()};order.paymentStatus=input.status;
    const result=await env.DB.prepare('UPDATE order_requests SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(order),new Date().toISOString(),input.id,input.revision).run();if(!result.meta.changes)throw new ApiError(409,'The order changed. Reload before reviewing.');
    try{const settings=await getPaymentMailSettings(env);for(const [kind,to] of [['owner',settings.notificationEmail],['customer',order.customer.email]]){if(!to)continue;const message=paymentReviewEmail({...order,reference:row.reference},{owner:kind==='owner'});await env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,recipient,payload,status,created_at,attempts) VALUES (?,?,?,'pending',?,0)").bind(`${input.id}:payment:${input.revision+1}:${kind}`,to,JSON.stringify(message),Date.now()).run()}await flushEmails(env)}catch{console.error('Payment review email queue unavailable')}
    return json({saved:true});
   }
   if(path==='/api/admin/orders'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT id,reference,payload,status,revision,created_at,updated_at FROM order_requests ORDER BY created_at DESC LIMIT 100').all();
    const counts=await env.DB.prepare('SELECT status, count(*) as count FROM order_requests GROUP BY status').all();
    return json({orders:(rows.results||[]).map(r=>({...JSON.parse(r.payload),id:r.id,reference:r.reference,status:r.status,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at})),counts:counts.results||[]});
   }
   if(path==='/api/admin/orders'&&request.method==='PATCH'){
    const input=await readJSON(request);if(!STOCK_STATUSES.includes(input.status)||typeof input.id!=='string'||!Number.isInteger(input.revision))throw new ApiError(400,'Choose a valid order status.');
    const before=await env.DB.prepare('SELECT reference,payload,status,revision FROM order_requests WHERE id=?').bind(input.id).first();
    if(before?.revision===input.revision&&before.status===input.status)return json({saved:true});
    const result=await env.DB.prepare('UPDATE order_requests SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(input.status,new Date().toISOString(),input.id,input.revision).run();if(!result.meta.changes)throw new ApiError(409,'The order changed elsewhere. Reload and try again.');
    try{await queueStatusEmails(env,{...JSON.parse(before.payload),reference:before.reference,status:input.status},input.id+':status:'+(input.revision+1));await flushEmails(env)}catch{console.error('Order status email queue unavailable')}
    return json({saved:true});
   }
   if(path==='/api/admin/mail'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT status,count(*) as count FROM email_outbox GROUP BY status').all();
    const recent=await env.DB.prepare('SELECT id,purpose,recipient,status,provider_id,last_error,created_at FROM email_activity ORDER BY created_at DESC LIMIT 20').all();
    const pending=await env.DB.prepare('SELECT pending_email,pending_email_expires FROM admin_credentials WHERE id=1').first();
    return json({configured:!!env.RESEND_API_KEY,...await mailSettings(env),pendingEmail:pending?.pending_email_expires>Date.now()?pending.pending_email:null,counts:rows.results||[],recent:recent.results||[]});
   }
   if(path==='/api/admin/mail/settings'&&request.method==='POST'){
    const input=await readJSON(request);await reauthenticate(request,env,input.currentPassword);return json({saved:true,settings:await saveMailSettings(env,input)});
   }
   if(path==='/api/admin/mail/test'&&request.method==='POST'){
    await limit(env,user.client,'mail-test',3,3600000);const settings=await mailSettings(env);
    try{const id=await sendEmail(env,settings.notificationEmail,testEmail(),'store-test-'+crypto.randomUUID(),'test');return json({accepted:true,to:settings.notificationEmail,providerId:id})}
    catch(error){throw new ApiError(503,/^Email provider error/.test(error.message)?error.message:'The test email could not be sent. Check the sending configuration.');}
   }
   if(path==='/api/admin/owner-email'&&request.method==='POST'){
    const input=await readJSON(request);try{return json(await requestOwnerEmailChange(request,env,input,({to,url,id})=>sendEmail(env,to,verificationEmail(url),'store-owner-'+id,'owner-verification')))}
    catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'The verification email could not be sent. No owner change was made.');}
   }
   if(path==='/api/admin/owner-email/cancel'&&request.method==='POST'){
    await env.DB.prepare('UPDATE admin_credentials SET pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL WHERE id=1').run();return json({saved:true});
   }
   if(path==='/api/admin/mail/retry'&&request.method==='POST'){await flushEmails(env);return json({saved:true});}
   if(path==='/api/admin/mail-preview'&&request.method==='GET'){
    const kind=new URL(request.url).searchParams.get('template');
    const demo={reference:'PREVIEW',items:[{name:'Example product',quantity:1,unitPrice:3000,total:3000}],subtotal:3000,customer:{name:'Customer',phone:'',city:'',email:''}};
    const message=kind==='password'?passwordEmail('https://www.mdkelectronics.com/admin/reset?token='+'0'.repeat(64)):orderEmail(demo);
    return new Response(message.html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",'Referrer-Policy':'no-referrer'}});
   }
   throw new ApiError(404,'Admin action not found.');
  }
  if(path==='/api/contact'&&request.method==='POST'){
   requireSameOrigin(request);const input=await readJSON(request);
   const user=request.headers.has('x-mdk-guest')?await gatewayGuest(request,env,JSON.stringify(input),'contact'):identity(request);if(!user)throw new ApiError(401,'Store connection could not be verified.');
   if(input.website)return json({saved:true,reference:'THANK-YOU'},201);
   const saved=await saveContact(env,input,user.id);try{await flushEmails(env)}catch{console.error('Contact email queue unavailable')}return json(saved,201);
  }
  if(path==='/api/orders'&&request.method==='POST'){
   requireSameOrigin(request);
   const input=await readJSON(request,2900000);
   const user=request.headers.has('x-mdk-guest')?await gatewayGuest(request,env,JSON.stringify(input)):identity(request);if(!user)throw new ApiError(401,'Sign in before submitting your request.');
   if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw new ApiError(400,'Invalid request reference.');
   const previous=await env.DB.prepare('SELECT owner_id,reference,payload FROM order_requests WHERE id=?').bind(input.requestId).first();
   if(previous){if(previous.owner_id!==user.id)throw new ApiError(409,'Use a new order reference.');const order={...JSON.parse(previous.payload),reference:previous.reference};try{await queueOrderEmails(env,order,input.requestId);await flushEmails(env)}catch{console.error('Order email queue unavailable')}return json({...publicOrderResult(order),whatsappUrl:'https://wa.me/923145851509?text='+encodeURIComponent(orderMessage(order))});}
   const threshold=new Date(Date.now()-10*60*1000).toISOString();const recent=await env.DB.prepare('SELECT count(*) as count FROM order_requests WHERE owner_id=? AND created_at>?').bind(user.id,threshold).first();if(recent.count>=5)throw new ApiError(429,'Please wait before submitting another request.');
   const order=validateOrder(input,await catalogue(env.DB));const validated=validatePayment(input.payment);if(validated.bytes&&!order.customer.email)throw new ApiError(400,'Add your email for payment updates.');order.payment=await storePaymentProof(env,input.requestId,validated);order.paymentStatus=order.payment.status;const now=new Date().toISOString();const reference='MDK-'+crypto.randomUUID().slice(0,8).toUpperCase();
   await env.DB.prepare('INSERT INTO order_requests (id,owner_id,reference,payload,status,revision,created_at,updated_at) VALUES (?,?,?,?,\'pending\',1,?,?)').bind(input.requestId,user.id,reference,JSON.stringify(order),now,now).run();
   try{await queueOrderEmails(env,{...order,reference},input.requestId);await flushEmails(env);}catch{console.error('Order email queue unavailable');}
   return json({...publicOrderResult({...order,reference}),whatsappUrl:'https://wa.me/923145851509?text='+encodeURIComponent(orderMessage({...order,reference}))},201);
  }
  throw new ApiError(404,'Page not found.');
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Store API error',path,error?.name);return json({error:'The store could not complete this request. Please try again.'},500);}
}
