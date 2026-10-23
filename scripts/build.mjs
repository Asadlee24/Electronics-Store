import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shell,home,shop,product,checkout,contact,information,notFound} from '../src/render.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
const products=JSON.parse(await fs.readFile(path.join(root,'src/catalog.json'),'utf8'));
const pages=JSON.parse(await fs.readFile(path.join(root,'src/pages.json'),'utf8'));
const origin=(process.env.SITE_URL||'').replace(/\/$/,'');
if(origin&&!/^https:\/\/[^/?#]+$/.test(origin))throw new Error('SITE_URL must be an HTTPS origin, without a path.');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'public'),out,{recursive:true});
for(const file of ['app.js','styles.css','store.mjs','catalog.json'])await fs.copyFile(path.join(root,'src',file),path.join(out,file));
// Only browser-safe formatting functions are exported into the UI helper.
const render=await fs.readFile(path.join(root,'src/render.mjs'),'utf8');
const ui=render.slice(0,render.indexOf('const pill ='));
await fs.writeFile(path.join(out,'ui.mjs'),ui);
const routes=[];
async function write(route,title,content,extra={}){const target=route==='404.html'?path.join(out,route):path.join(out,route,'index.html');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,shell({title,content,path:route==='404.html'?'/404/':'/'+(route?route+'/':''),origin,...extra}));if(route!=='404.html')routes.push('/'+(route?route+'/':''));}
await write('','Small tech. Big possibilities.',home(products));
await write('shop','The collection',shop(products));
await write('wishlist','Your wishlist',shop(products,true));
await write('wishlist-2','Your wishlist',shop(products,true));
await write('checkout','Request your order',checkout());
await write('cart','Your bag',checkout());
await write('contact-us','Contact us',contact());
for(const p of products)await write('product/'+p.slug,p.name,product(p,products),{product:p});
for(const p of pages)await write(p.slug,p.title,information(p));
await write('404.html','Page not found',notFound());
// Crawlers get real product pages; private shopping state stays out of the sitemap.
const publicRoutes=routes.filter(x=>!['/wishlist/','/wishlist-2/','/cart/','/checkout/'].includes(x));
await fs.writeFile(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /checkout/\nDisallow: /cart/\nDisallow: /wishlist/\n${origin?'Sitemap: '+origin+'/sitemap.xml\n':''}`);
if(origin)await fs.writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicRoutes.map(r=>`<url><loc>${origin}${r}</loc></url>`).join('')}</urlset>`);
await fs.writeFile(path.join(out,'routes.json'),JSON.stringify(routes,null,2));
console.log(`Built ${routes.length} pages and 404.html. ${products.length} products, ${pages.length} information pages.`);
