export const MAX_QUANTITY = 20;
export function normalizeBag(value, products) {
  if (!Array.isArray(value)) return [];
  const result = new Map();
  for (const item of value) {
    if (!item || !Number.isInteger(item.id)) continue;
    const product = products.find(p=>p.id===item.id);
    if (!product?.inStock || !product.purchasable || !Number.isFinite(item.quantity) || item.quantity < 1) continue;
    result.set(item.id, Math.min(MAX_QUANTITY, (result.get(item.id)||0)+Math.floor(item.quantity)));
  }
  return [...result].map(([id, quantity])=>({id,quantity}));
}
export function bagTotal(bag, products) {
  return normalizeBag(bag,products).reduce((sum,item)=>sum+products.find(p=>p.id===item.id).price*item.quantity,0);
}
export function filterProducts(products, {query='',category='all',inStock=false,wishlist=null,sort='featured'}={}) {
  const categoryMap={cctv:'CCTV Cameras',compact:'Hidden Cameras',electronics:'Electronics',audio:'Speaker'};
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result=products.filter(p=>{
    const text=(p.name+' '+p.categories.join(' ')).toLowerCase();
    return terms.every(t=>text.includes(t)) && (!categoryMap[category]||p.categories.includes(categoryMap[category])) && (!inStock||p.inStock) && (!wishlist||wishlist.includes(p.id));
  });
  if(sort==='price-up') result.sort((a,b)=>a.price-b.price);
  if(sort==='price-down') result.sort((a,b)=>b.price-a.price);
  if(sort==='name') result.sort((a,b)=>a.name.localeCompare(b.name));
  return result;
}
export function orderMessage(bag, products, details) {
  const items=normalizeBag(bag,products);
  if(!items.length) throw new Error('Your bag is empty.');
  const safe=value=>String(value||'').replace(/[\r\n]+/g,' ').trim();
  return [
    'Hi MDK Electronics, I would like to request this order:', '',
    ...items.map(item=>{const p=products.find(p=>p.id===item.id);return `${item.quantity} × ${p.name} — Rs. ${(p.price*item.quantity).toLocaleString('en-PK')}\n${p.sourceUrl}`;}),
    '', `Product subtotal: Rs. ${bagTotal(items,products).toLocaleString('en-PK')}`,
    'Please confirm availability, delivery charges and payment details.', '',
    `Name: ${safe(details.name)}`, `Phone: ${safe(details.phone)}`,
    ...(details.email?[`Email: ${safe(details.email)}`]:[]),
    `Address: ${safe(details.address)}`, `City: ${safe(details.city)}, Pakistan`,
    ...(details.notes?['Notes: '+safe(details.notes)]:[]), '',
    'This is an order request, pending confirmation from MDK Electronics.'
  ].join('\n');
}
