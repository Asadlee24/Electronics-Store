import informationPages from '../src/pages.json' with {type:'json'};
import {shell,home,shop,product,checkout,contact,information,notFound} from '../src/render.mjs';
import {api} from './api.mjs';
import {catalogue,requireAdmin,ApiError} from './catalogue.mjs';
import {adminPage,adminGate} from './admin-page.mjs';
const html=(body,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'SAMEORIGIN'}});
export async function route(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path.startsWith('/api/')||path.startsWith('/media/'))return api(request,env);
 if(path==='/robots.txt')return new Response('User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nDisallow: /checkout/\nSitemap: '+url.origin+'/sitemap.xml\n',{headers:{'Content-Type':'text/plain'}});
 if(path==='/admin'||path.startsWith('/admin/')){try{requireAdmin(request,env);return html(adminPage())}catch(e){return html(adminGate(e.message,e.status===401),e.status||500)}}
 if(request.method!=='GET'&&request.method!=='HEAD')return null;
 if(/\.(css|js|mjs|png|jpe?g|webp|svg|ico|woff2?)$/.test(path)||path.startsWith('/@')||path.startsWith('/node_modules/'))return null;
 try{
  const products=env.CATALOGUE?await env.CATALOGUE():await catalogue(env.DB),routePath=path.replace(/\/$/,'')||'/';
  if(path==='/sitemap.xml'){const paths=['/','/shop/','/contact-us/',...informationPages.map(p=>'/'+p.slug+'/'),...products.map(p=>'/product/'+p.slug+'/')];return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map(p=>'<url><loc>'+url.origin+p+'</loc></url>').join('')+'</urlset>',{headers:{'Content-Type':'application/xml'}});}
  if(path==='/catalog.json')return new Response(JSON.stringify(products),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  let title,content,selected,status=200;
  if(routePath==='/'){title='Cameras, audio & electronics';content=home(products)}
  else if(routePath==='/shop'){title='Shop';content=shop(products)}
  else if(['/wishlist','/wishlist-2'].includes(routePath)){title='Wishlist';content=shop(products,true)}
  else if(['/checkout','/cart'].includes(routePath)){title='Order request';content=checkout()}
  else if(routePath==='/contact-us'){title='Contact';content=contact()}
  else if(routePath.startsWith('/product/')){selected=products.find(p=>p.slug===routePath.slice(9));if(selected){title=selected.name;content=product(selected,products)}else{title='Product not found';content=notFound();status=404}}
  else {const page=informationPages.find(p=>routePath==='/'+p.slug);if(page){title=page.title;content=information(page)}else{title='Page not found';content=notFound();status=404}}
  return html(shell({title,content,product:selected,path,origin:url.origin}),status);
 }catch(e){console.error('Store page unavailable',e?.name);return html(shell({title:'Store unavailable',content:'<section class="section"><h1>We’ll be right back.</h1><p>The store is temporarily unavailable. Please try again shortly.</p><a href="https://wa.me/923145851509">Contact MDK on WhatsApp</a>',path,origin:url.origin}),503);}
}
