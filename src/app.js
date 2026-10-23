import {normalizeBag, bagTotal, filterProducts, orderMessage, MAX_QUANTITY} from '/store.mjs';
import {icon, money, esc} from '/ui.mjs';
const products = await fetch('/catalog.json').then(r=>{if(!r.ok)throw new Error('Cannot load products');return r.json()}).catch(()=>[]);
const $ = (selector,root=document)=>root.querySelector(selector);
const $$ = (selector,root=document)=>[...root.querySelectorAll(selector)];
function load(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function persist(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
let bag=normalizeBag(load('mdk-bag-v1',[]),products);
let wishlist=load('mdk-wishlist-v1',[]);
if(!Array.isArray(wishlist))wishlist=[];
wishlist=[...new Set(wishlist.filter(id=>products.some(p=>p.id===id)))];
let toastTimer;
function toast(message){const element=$('#toast');element.textContent=message;element.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove('visible'),3000)}
function openDialog(id){const d=$(id);if(!d.open)d.showModal()}
$$('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});d.addEventListener('close',()=>document.body.classList.remove('dialog-open'))});
function open(id){document.body.classList.add('dialog-open');openDialog(id)}
function lineItem(item,compact=false){const p=products.find(p=>p.id===item.id);if(!p)return '';return `<div class="bag-item"><a class="bag-item-image" href="/product/${p.slug}/"><img src="${p.images[0]}" width="90" height="90" alt="${esc(p.name)}"></a><div class="bag-item-info"><a href="/product/${p.slug}/">${esc(p.name)}</a><span>${money(p.price)}</span>${compact?`<small>Quantity: ${item.quantity}</small>`:`<div class="bag-item-actions"><div class="quantity-control small-quantity"><button class="icon-button" data-change="${p.id}" data-delta="-1" aria-label="Decrease ${esc(p.name)} quantity">${icon('minus')}</button><span>${item.quantity}</span><button class="icon-button" data-change="${p.id}" data-delta="1" aria-label="Increase ${esc(p.name)} quantity" ${item.quantity>=MAX_QUANTITY?'disabled':''}>${icon('plus')}</button></div><button class="remove-link" data-remove="${p.id}">Remove</button></div>`}</div><strong class="line-total">${money(p.price*item.quantity)}</strong></div>`}
function totals(){return `<div class="total-line"><span>Product subtotal</span><strong>${money(bagTotal(bag,products))}</strong></div><div class="total-line muted"><span>Delivery</span><span>Confirmed by our team</span></div><p class="small muted">Final availability, delivery charges and payment are confirmed on WhatsApp.</p>`}
function renderBag(){
 const count=bag.reduce((s,x)=>s+x.quantity,0);$$('.bag-count').forEach(e=>e.textContent=count);
 $('#bag-items').innerHTML=bag.length?bag.map(x=>lineItem(x)).join(''):`<div class="empty-state">${icon('bag')}<h3>A little room for something good.</h3><p>Your bag is empty. Find your next upgrade.</p><a class="button dark" href="/shop/">Explore the collection ${icon('arrow')}</a></div>`;
 $('#bag-summary').innerHTML=bag.length?`${totals()}<a class="button dark" href="/checkout/">Request your order ${icon('arrow')}</a><button class="continue-shopping" data-close-dialog>Continue exploring</button>`:'';
 if($('#checkout-items')){
  $('#checkout-items').innerHTML=bag.map(x=>lineItem(x,true)).join('');$('#checkout-totals').innerHTML=totals();$('#checkout-layout').hidden=!bag.length;$('#checkout-empty').hidden=!!bag.length;
 }
}
function renderWishlist(){
 $$('[data-wish]').forEach(b=>{const saved=wishlist.includes(Number(b.dataset.wish));b.setAttribute('aria-pressed',String(saved));b.setAttribute('aria-label',`${saved?'Unsave':'Save'} ${products.find(p=>p.id===Number(b.dataset.wish))?.name||'product'}`)});
 $$('.wish-count').forEach(e=>{e.textContent=wishlist.length;e.hidden=!wishlist.length});
 if($('[data-shop="wishlist"]'))applyFilters();
}
function saveBag(){bag=normalizeBag(bag,products);persist('mdk-bag-v1',bag);renderBag()}
document.addEventListener('click',e=>{
 const target=e.target.closest('button,a');if(!target)return;
 if(target.matches('[data-open-bag]')){renderBag();open('#bag-dialog')}
 if(target.matches('[data-open-search]')){open('#search-dialog');renderSuggestions('');$('#global-search').focus()}
 if(target.matches('[data-open-menu]'))open('#menu-dialog');
 if(target.matches('[data-close-dialog]'))target.closest('dialog')?.close();
 if(target.matches('[data-add]')){
  const p=products.find(x=>x.id===Number(target.dataset.add));if(!p?.inStock||!p.purchasable)return;
  const raw=target.hasAttribute('data-use-quantity')?Number($('#product-quantity').value):1;
  const quantity=Math.max(1,Math.min(MAX_QUANTITY,Number.isFinite(raw)?Math.floor(raw):1));
  const item=bag.find(x=>x.id===p.id);if(item)item.quantity=Math.min(MAX_QUANTITY,item.quantity+quantity);else bag.push({id:p.id,quantity});saveBag();toast(`${p.name} added to your bag`);
  const old=target.innerHTML;target.innerHTML=icon('check');target.classList.add('just-added');setTimeout(()=>{target.innerHTML=old;target.classList.remove('just-added')},1200);
 }
 if(target.matches('[data-wish]')){const id=Number(target.dataset.wish);wishlist=wishlist.includes(id)?wishlist.filter(x=>x!==id):[...wishlist,id];persist('mdk-wishlist-v1',wishlist);renderWishlist();toast(wishlist.includes(id)?'Saved for another look':'Removed from your wishlist')}
 if(target.matches('[data-change]')){const item=bag.find(x=>x.id===Number(target.dataset.change));if(item){item.quantity+=Number(target.dataset.delta);saveBag()}}
 if(target.matches('[data-remove]')){bag=bag.filter(x=>x.id!==Number(target.dataset.remove));saveBag()}
});
window.addEventListener('storage',event=>{if(event.key==='mdk-bag-v1'){bag=normalizeBag(load('mdk-bag-v1',[]),products);renderBag()}if(event.key==='mdk-wishlist-v1'){const value=load('mdk-wishlist-v1',[]);wishlist=Array.isArray(value)?value.filter(id=>products.some(p=>p.id===id)):[];renderWishlist()}});
// Live collection filters preserve shareable URLs without intercepting normal links.
const params=new URLSearchParams(location.search);
let category=['all','cctv','compact','audio','electronics'].includes(params.get('category'))?params.get('category'):'all';
const collectionSearch=$('#collection-search');if(collectionSearch)collectionSearch.value=params.get('q')||'';
function applyFilters(updateUrl=false){
 const grid=$('#collection-grid');if(!grid)return;
 const selection=filterProducts(products,{query:collectionSearch?.value||'',category,inStock:$('#in-stock-only')?.checked,wishlist:$('[data-shop="wishlist"]')?wishlist:null,sort:$('#sort-products')?.value});
 const cards=new Map($$('.product-card',grid).map(e=>[Number(e.dataset.productId),e]));
 cards.forEach(card=>card.hidden=true);selection.forEach(p=>{const card=cards.get(p.id);if(card){card.hidden=false;grid.append(card)}});
 $('#result-count').textContent=`${selection.length} ${selection.length===1?'product':'products'}`;$('#empty-results').hidden=selection.length>0;
 $$('.category-tab').forEach(b=>{const active=b.dataset.filter===category;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
 if(updateUrl){const url=new URL(location.href);if(category==='all')url.searchParams.delete('category');else url.searchParams.set('category',category);if(collectionSearch.value)url.searchParams.set('q',collectionSearch.value);else url.searchParams.delete('q');history.replaceState({},'',url)}
}
$$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{category=b.dataset.filter;applyFilters(true)}));
collectionSearch?.addEventListener('input',()=>applyFilters(true));$('#sort-products')?.addEventListener('change',()=>applyFilters());$('#in-stock-only')?.addEventListener('change',()=>applyFilters());
$('#reset-filters')?.addEventListener('click',()=>{category='all';collectionSearch.value='';$('#in-stock-only').checked=false;$('#sort-products').value='featured';applyFilters(true)});
function renderSuggestions(query){const found=filterProducts(products,{query}).slice(0,4);$('#search-suggestions').innerHTML=found.length?found.map(p=>`<a class="suggestion" href="/product/${p.slug}/"><img src="${p.images[0]}" alt="" width="58" height="58"><span>${esc(p.name)}<small>${money(p.price)}</small></span>${icon('arrow')}</a>`).join(''):'<p>No products found. Try another search.</p>'}
$('#global-search')?.addEventListener('input',e=>renderSuggestions(e.target.value));
// Product gallery and quantities.
$$('[data-gallery]').forEach(b=>b.addEventListener('click',()=>{const image=$('#gallery-main');image.src=b.dataset.gallery;$('#gallery-index').textContent=b.dataset.index.padStart(2,'0');$$('[data-gallery]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b))})}));
for(const [selector,delta] of [['#product-minus',-1],['#product-plus',1]])$(selector)?.addEventListener('click',()=>{const input=$('#product-quantity');input.value=Math.max(1,Math.min(MAX_QUANTITY,(Number(input.value)||1)+delta))});
$('#product-quantity')?.addEventListener('change',e=>{e.target.value=Math.max(1,Math.min(MAX_QUANTITY,Math.floor(Number(e.target.value)||1)))});
// The buyer reviews and sends the request themselves; no order or payment is fabricated.
$('#order-form')?.addEventListener('submit',event=>{event.preventDefault();if(!event.target.reportValidity())return;const details=Object.fromEntries(new FormData(event.target));const message=orderMessage(bag,products,details);const url='https://wa.me/923145851509?text='+encodeURIComponent(message);const next=document.createElement('a');next.href=url;next.target='_blank';next.rel='noopener';next.click();$('#order-status').innerHTML=`Your order request is ready. <a href="${esc(url)}" target="_blank" rel="noopener">Open WhatsApp again ${icon('upRight')}</a>. Review the message and send it to MDK to continue.`;});
// Original photography, gently suspended in a perspective showroom.
const showroom=$('#showroom');
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let frame=0;
showroom?.addEventListener('pointermove',event=>{if(reducedMotion.matches||event.pointerType==='touch')return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const r=showroom.getBoundingClientRect();const x=(event.clientX-r.left)/r.width-.5;const y=(event.clientY-r.top)/r.height-.5;showroom.style.setProperty('--rx',`${-y*10}deg`);showroom.style.setProperty('--ry',`${x*14}deg`);showroom.style.setProperty('--mx',`${x*15}px`);showroom.style.setProperty('--my',`${y*12}px`);})});
showroom?.addEventListener('pointerleave',()=>{cancelAnimationFrame(frame);['--rx','--ry','--mx','--my'].forEach(key=>showroom.style.removeProperty(key))});
const slides={737:{name:'Hikvision 2MP',kicker:'YOUR SPACE. IN FOCUS.',color:'#dedfd3',index:'01 / THE EVERYDAY UPGRADE',outline:'SEE<br>CLEARER.'},842:{name:'Mini Handy Cam',kicker:'CAPTURE THE EVERYDAY.',color:'#e5d6c5',index:'02 / KEEP THE MOMENT',outline:'MORE<br>MOMENTS.'},571:{name:'W-KING T9 Pro',kicker:'TURN UP THE MOMENT.',color:'#dcd5e7',index:'03 / GOOD SOUND. GOOD TIMES.',outline:'SOUND<br>ON.'}};
$$('[data-slide]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.slide),p=products.find(x=>x.id===id),s=slides[id];if(!p)return;const hero=$('#hero-product');hero.classList.remove('product-enter');void hero.offsetWidth;hero.classList.add('product-enter');$('#hero-image').src=id===737?'/images/hikvision-hero-v2.png':p.images[0];hero.classList.toggle('has-source-photo',id!==737);$('#hero-image').alt=p.name;$('#hero-name').textContent=s.name;$('#hero-price').textContent=money(p.price);$('#hero-kicker').textContent=s.kicker;$('#hero-link').href='/product/'+p.slug+'/';$('#hero-category').textContent=p.categories[0].toUpperCase();$('.showroom-index').textContent=s.index;$('.hero-outline').innerHTML=s.outline;showroom.style.setProperty('--scene',s.color);$$('[data-slide]').forEach(dot=>{dot.classList.toggle('active',dot===b);dot.setAttribute('aria-pressed',String(dot===b))})}));
renderBag();renderWishlist();applyFilters();
