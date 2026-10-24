import originalProducts from '../src/catalog.json' with {type:'json'};
export const CATEGORY_NAMES=['CCTV Cameras','Hidden Cameras','Electronics','Speaker'];
export const STOCK_STATUSES=['pending','confirmed','dispatched','completed','cancelled'];
export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function identity(request){const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');return id&&email?{id,email:email.toLowerCase().trim()}:null;}
export function requireAdmin(request,env){const user=identity(request);if(!user)throw new ApiError(401,'Sign in to manage your store.');if(!env.ADMIN_EMAIL||user.email!==env.ADMIN_EMAIL.toLowerCase().trim())throw new ApiError(403,'This account cannot manage the store.');return user;}
export function requireSameOrigin(request){const url=new URL(request.url);if(request.headers.get('origin')!==url.origin)throw new ApiError(403,'Please submit this request from the store.');const site=request.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw new ApiError(403,'Cross-site request blocked.');}
export function text(value,name,max,required=true){if(typeof value!=='string'||(required&&!value.trim())||value.length>max)throw new ApiError(400,`${name} is required and must be under ${max} characters.`);return value.trim();}
export function validImagePath(value){return typeof value==='string'&&(/^\/images\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(value)||/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(value));}
export function validateProduct(input,existing){
 const name=text(input.name,'Product name',160),slug=text(input.slug,'Product URL',160);
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new ApiError(400,'Use lowercase letters, numbers and hyphens for the product URL.');
 const price=Number(input.price),regularPrice=Number(input.regularPrice||input.price);
 if(!Number.isFinite(price)||price<=0||price>10000000||!Number.isFinite(regularPrice)||regularPrice<price||regularPrice>10000000)throw new ApiError(400,'Enter a valid price. The original price cannot be lower than the selling price.');
 if(!CATEGORY_NAMES.includes(input.category))throw new ApiError(400,'Choose a product category.');
 if(!Array.isArray(input.images)||!input.images.length||input.images.length>10||input.images.some(x=>!validImagePath(x)))throw new ApiError(400,'Add 1–10 product photos uploaded to this store.');
 if(typeof input.inStock!=='boolean'||typeof input.active!=='boolean')throw new ApiError(400,'Choose a stock and publishing status.');
 const description=text(input.description||'','Description',10000,false);
 const short=text(input.shortDescription||'','Short description',1500,false);
 const paragraphs=value=>value?value.split(/\n\s*\n/).map(p=>'<p>'+escapeHTML(p).replace(/\n/g,'<br>')+'</p>').join(''):'';
 return {...(existing||{}),id:existing?.id,name,slug,price:Math.round(price*100)/100,regularPrice:Math.round(regularPrice*100)/100,currency:'PKR',categories:[input.category],images:[...new Set(input.images)],inStock:input.inStock,purchasable:true,active:input.active,description:paragraphs(description),shortDescription:paragraphs(short),sku:existing?.sku||'',reviewCount:0,rating:'0',sourceUrl:existing?.sourceUrl||'',sourceImages:existing?.sourceImages||[]};
}
export async function catalogue(db,{all=false}={}){
 if(!db)throw new ApiError(503,'Store data is temporarily unavailable.');
 const {results}=await db.prepare('SELECT id, payload, revision FROM catalogue_products').all();
 const merged=new Map(originalProducts.map(p=>[p.id,{...p,active:true,revision:0}]));
 for(const row of results||[])merged.set(row.id,{...JSON.parse(row.payload),revision:row.revision});
 return [...merged.values()].filter(p=>p.deleted!==true&&(all||p.active!==false));
}
export function validateOrder(input,products){
 const details=input.details||{};
 const customer={name:text(details.name,'Full name',100),phone:text(details.phone,'Phone number',22),address:text(details.address,'Address',400),city:text(details.city,'City',80),email:text(details.email||'','Email',160,false),notes:text(details.notes||'','Notes',500,false)};
 if(!/^[+0-9 ()-]{7,22}$/.test(customer.phone))throw new ApiError(400,'Enter a valid phone number.');
 if(customer.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email))throw new ApiError(400,'Enter a valid email address.');
 if(input.consent!==true)throw new ApiError(400,'Please agree to the terms and privacy policy.');
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)throw new ApiError(400,'Your cart must contain 1–20 products.');
 const seen=new Set();
 const items=input.items.map(item=>{const p=products.find(x=>x.id===item.id);if(!p||!p.inStock||!p.purchasable)throw new ApiError(409,'A product in your cart is no longer available. Please update your cart.');if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20||seen.has(p.id))throw new ApiError(400,'Check the quantities in your cart.');seen.add(p.id);return{id:p.id,name:p.name,slug:p.slug,image:p.images[0],quantity:item.quantity,unitPrice:p.price,total:Math.round(p.price*item.quantity*100)/100}});
 return {customer,items,subtotal:Math.round(items.reduce((n,x)=>n+x.total,0)*100)/100,currency:'PKR',shipping:null,paymentStatus:'unpaid'};
}
export function imageType(bytes){if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return {mime:'image/png',extension:'png'};if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return{mime:'image/jpeg',extension:'jpg'};if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return{mime:'image/webp',extension:'webp'};return null;}
export function orderMessage(order){const fmt=n=>'Rs. '+n.toLocaleString('en-PK');return[`MDK Electronics — order ${order.reference}`,'',...order.items.map(i=>`${i.quantity} × ${i.name} — ${fmt(i.total)}`),'',`Product subtotal: ${fmt(order.subtotal)}`,'Please confirm availability, delivery charges and payment.','',`Name: ${order.customer.name}`,`Phone: ${order.customer.phone}`,`Address: ${order.customer.address}`,`City: ${order.customer.city}`,...(order.customer.notes?[`Notes: ${order.customer.notes}`]:[])].join('\n');}
