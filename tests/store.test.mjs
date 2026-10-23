import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {normalizeBag, bagTotal, filterProducts, orderMessage} from '../src/store.mjs';
const products=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url),'utf8'));
const buy=products.find(p=>p.id===737), sold=products.find(p=>p.id===571);
test('cart storage rejects tampered, unknown, unavailable and malformed items',()=>{
 assert.deepEqual(normalizeBag([null,{id:737,quantity:2},{id:737,quantity:1.9},{id:571,quantity:1},{id:12,quantity:3},{id:921,quantity:0},{id:906,quantity:'4'}],products),[{id:737,quantity:3}]);
});
test('quantities are capped and totals use catalogue prices',()=>{
 assert.deepEqual(normalizeBag([{id:737,quantity:50}],products),[{id:737,quantity:20}]);
 assert.equal(bagTotal([{id:737,quantity:2,price:1}],products),6000);
});
test('the collection supports multi-term search, categories and stock state',()=>{
 assert.deepEqual(filterProducts(products,{query:'hikvision camera',category:'cctv'}).map(x=>x.id),[737]);
 assert.equal(filterProducts(products,{category:'audio',inStock:true}).length,0);
 assert.deepEqual(filterProducts(products,{category:'audio'}).map(x=>x.id),[571]);
});
test('wishlist and price sort compose correctly',()=>{
 assert.deepEqual(filterProducts(products,{wishlist:[921,737],sort:'price-up'}).map(x=>x.id),[737,921]);
});
test('order requests contain real products, exact subtotal and pending confirmation',()=>{
 const message=orderMessage([{id:737,quantity:2}],products,{name:'Buyer\nInjected',phone:'03140000000',address:'Demo road',city:'Peshawar'});
 assert.match(message,/2 × Hikvision 2MP Camera/);assert.match(message,/Product subtotal: Rs\. 6,000/);assert.match(message,/Name: Buyer Injected/);assert.match(message,/pending confirmation/);assert.match(message,/Please confirm availability, delivery charges/);
 assert.throws(()=>orderMessage([],products,{}),/empty/);
});
test('the import preserves nine electronics listings and original prices and stock',()=>{
 assert.equal(products.length,9);assert.equal(buy.price,3000);assert.equal(sold.price,15000);assert.equal(sold.inStock,false);assert.equal(products.find(x=>x.id===921).price,10999);
 assert.equal(products.some(x=>x.id===832),false);assert.equal(new Set(products.map(x=>x.slug)).size,products.length);
});
test('every imported gallery image exists locally',()=>{
 for(const p of products)for(const image of p.images){const asset=new URL('../public'+image,import.meta.url);assert.ok(fs.statSync(asset).size>1000,`${p.name}: ${image}`)}
});
test('imported descriptions and policies contain only inert semantic HTML',()=>{
 const pages=JSON.parse(fs.readFileSync(new URL('../src/pages.json',import.meta.url),'utf8'));
 for(const text of [...products.map(p=>p.description+p.shortDescription),...pages.map(p=>p.content)]){
  assert.doesNotMatch(text,/<(?:script|iframe|form|style)\b/i);assert.doesNotMatch(text,/<[^>]*\bon\w+=/i);
 }
 const returns=pages.find(x=>x.slug==='return-refund-policy');assert.match(returns.content,/7 days/);assert.doesNotMatch(returns.content,/30 days/);
});
test('every internal href and asset in the built storefront resolves',()=>{
 const root=new URL('../dist/',import.meta.url),all=[];
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.html'))all.push(file)}}
 walk(root.pathname);assert.ok(all.length>=22);
 for(const file of all){const html=fs.readFileSync(file,'utf8');for(const match of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)){
  const pathname=match[1].split('?')[0];const local=path.join(root.pathname,pathname,pathname.endsWith('/')?'index.html':'');assert.ok(fs.existsSync(local),`${path.relative(root.pathname,file)} points to missing ${pathname}`);
 }assert.equal((html.match(/<h1\b/g)||[]).length,1,`${file} needs one primary heading`)}
});
