import {ApiError,identity,requireAdmin,requireSameOrigin,catalogue,validateProduct,validateOrder,imageType,orderMessage,STOCK_STATUSES} from './catalogue.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function readJSON(request){if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'Send JSON data.');const body=await request.text();if(body.length>50000)throw new ApiError(413,'Request is too large.');try{return JSON.parse(body)}catch{throw new ApiError(400,'Invalid request data.')}}
export async function api(request,env){
 const path=new URL(request.url).pathname.replace(/\/$/,'');
 if(!path.startsWith('/api/')&&!path.startsWith('/media/'))return null;
 try{
  if(path.startsWith('/media/')&&request.method==='GET'){
   if(!/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(path))throw new ApiError(404,'Image not found.');
   const object=await env.BUCKET?.get(path.slice(7));if(!object)throw new ApiError(404,'Image not found.');
   const headers=new Headers({'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});return new Response(object.body,{headers});
  }
  if(path==='/api/catalog'&&request.method==='GET')return json(await catalogue(env.DB));
  if(path.startsWith('/api/admin/')){
   const user=requireAdmin(request,env);
   if(request.method!=='GET')requireSameOrigin(request);
   if(path==='/api/admin/me'&&request.method==='GET')return json({email:user.email,canEdit:true});
   if(path==='/api/admin/products'&&request.method==='GET')return json({products:await catalogue(env.DB,{all:true})});
   if(path==='/api/admin/products'&&request.method==='POST'){
    const input=await readJSON(request);const products=await catalogue(env.DB,{all:true});
    const existing=input.id?products.find(p=>p.id===input.id):null;
    if(input.id&&!existing)throw new ApiError(404,'Product not found.');
    if(existing&&input.revision!==existing.revision)throw new ApiError(409,'This product changed in another session. Reload before saving.');
    const product=validateProduct(input,existing);
    if(products.some(p=>p.slug===product.slug&&p.id!==existing?.id))throw new ApiError(409,'That product URL is already in use.');
    product.id=existing?.id||(100000+crypto.getRandomValues(new Uint32Array(1))[0]);
    const at=new Date().toISOString();
    const result=await env.DB.prepare('INSERT INTO catalogue_products (id,slug,payload,revision,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,payload=excluded.payload,revision=catalogue_products.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE catalogue_products.revision=?').bind(product.id,product.slug,JSON.stringify(product),at,user.id,existing?.revision||0).run();
    if(!result.meta.changes)throw new ApiError(409,'This product was changed elsewhere. Reload before saving.');
    return json({product:{...product,revision:(existing?.revision||0)+1}},existing?200:201);
   }
   if(path==='/api/admin/upload'&&request.method==='POST'){
    if(!env.BUCKET)throw new ApiError(503,'Photo storage is not available.');
    const length=Number(request.headers.get('content-length')||0);if(length>6*1024*1024)throw new ApiError(413,'Choose a photo smaller than 6 MB.');
    const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>6*1024*1024||bytes.length<20)throw new ApiError(413,'Choose a photo between 20 bytes and 6 MB.');
    const type=imageType(bytes);if(!type||request.headers.get('content-type')?.split(';')[0]!==type.mime)throw new ApiError(415,'Use a JPG, PNG or WebP photo.');
    const key=crypto.randomUUID()+'.'+type.extension;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type.mime}});return json({url:'/media/'+key},201);
   }
   if(path==='/api/admin/orders'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT id,reference,payload,status,revision,created_at,updated_at FROM order_requests ORDER BY created_at DESC LIMIT 100').all();
    const counts=await env.DB.prepare('SELECT status, count(*) as count FROM order_requests GROUP BY status').all();
    return json({orders:(rows.results||[]).map(r=>({...JSON.parse(r.payload),id:r.id,reference:r.reference,status:r.status,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at})),counts:counts.results||[]});
   }
   if(path==='/api/admin/orders'&&request.method==='PATCH'){
    const input=await readJSON(request);if(!STOCK_STATUSES.includes(input.status)||typeof input.id!=='string'||!Number.isInteger(input.revision))throw new ApiError(400,'Choose a valid order status.');
    const result=await env.DB.prepare('UPDATE order_requests SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(input.status,new Date().toISOString(),input.id,input.revision).run();if(!result.meta.changes)throw new ApiError(409,'The order changed elsewhere. Reload and try again.');return json({saved:true});
   }
   throw new ApiError(404,'Admin action not found.');
  }
  if(path==='/api/orders'&&request.method==='POST'){
   requireSameOrigin(request);const user=identity(request);if(!user)throw new ApiError(401,'Sign in before submitting your request.');
   const input=await readJSON(request);if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw new ApiError(400,'Invalid request reference.');
   const previous=await env.DB.prepare('SELECT owner_id,reference,payload FROM order_requests WHERE id=?').bind(input.requestId).first();
   if(previous){if(previous.owner_id!==user.id)throw new ApiError(409,'Use a new order reference.');const order={...JSON.parse(previous.payload),reference:previous.reference};return json({reference:order.reference,whatsappUrl:'https://wa.me/923145851509?text='+encodeURIComponent(orderMessage(order))});}
   const threshold=new Date(Date.now()-10*60*1000).toISOString();const recent=await env.DB.prepare('SELECT count(*) as count FROM order_requests WHERE owner_id=? AND created_at>?').bind(user.id,threshold).first();if(recent.count>=5)throw new ApiError(429,'Please wait before submitting another request.');
   const order=validateOrder(input,await catalogue(env.DB));const now=new Date().toISOString();const reference='MDK-'+crypto.randomUUID().slice(0,8).toUpperCase();
   await env.DB.prepare('INSERT INTO order_requests (id,owner_id,reference,payload,status,revision,created_at,updated_at) VALUES (?,?,?,?,\'pending\',1,?,?)').bind(input.requestId,user.id,reference,JSON.stringify(order),now,now).run();
   return json({reference,whatsappUrl:'https://wa.me/923145851509?text='+encodeURIComponent(orderMessage({...order,reference}))},201);
  }
  throw new ApiError(404,'Page not found.');
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Store API error',path,error?.name);return json({error:'The store could not complete this request. Please try again.'},500);}
}
