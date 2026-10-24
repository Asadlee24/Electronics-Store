import defaults from '../src/hero-defaults.json' with {type:'json'};
import {ApiError,text,validImagePath} from './catalogue.mjs';
export async function heroSettings(db){
 const row=db?await db.prepare('SELECT payload,revision FROM hero_settings WHERE id=1').first():null;
 return {slides:row?JSON.parse(row.payload):structuredClone(defaults),revision:row?.revision||0};
}
export function visibleHero(slides,products){return slides.filter(s=>s.enabled!==false&&products.some(p=>p.id===s.productId&&p.active!==false)).map(s=>({...s,product:products.find(p=>p.id===s.productId)}));}
export function validateHero(input,products){
 if(!Number.isInteger(input.revision)||input.revision<0||!Array.isArray(input.slides)||input.slides.length<1||input.slides.length>6)throw new ApiError(400,'Use 1–6 slides.');
 const seen=new Set();const slides=input.slides.map(s=>{
  if(!s||!Number.isInteger(s.productId)||!products.some(p=>p.id===s.productId)||seen.has(s.productId))throw new ApiError(400,'Choose a different existing product for each slide.');
  seen.add(s.productId);if(!validImagePath(s.image))throw new ApiError(400,'Upload a store image for each slide.');
  if(!/^#[a-f0-9]{6}$/i.test(s.color||'')||typeof s.enabled!=='boolean')throw new ApiError(400,'Choose a background colour and visibility.');
  return {productId:s.productId,image:s.image,kicker:text(s.kicker,'Slide label',50),outline:text(s.outline||'','Backdrop text',12,false),color:s.color,enabled:s.enabled};
 });
 if(!visibleHero(slides,products).length)throw new ApiError(400,'Keep at least one published product slide visible.');return slides;
}
export async function saveHero(db,input,products){
 const slides=validateHero(input,products);
 const result=input.revision===0?await db.prepare('INSERT OR IGNORE INTO hero_settings (id,payload,revision) VALUES (1,?,1)').bind(JSON.stringify(slides)).run():await db.prepare('UPDATE hero_settings SET payload=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(slides),input.revision).run();
 if(!result.meta.changes)throw new ApiError(409,'Slides changed in another session. Reload before saving.');return {slides,revision:input.revision+1};
}
