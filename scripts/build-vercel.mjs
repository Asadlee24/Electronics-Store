import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import './sync-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.vercel/output'),fn=path.join(out,'functions/store.func');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(fn,{recursive:true});
// Explicit allowlists keep credentials, local databases, fixtures and build
// state out of both the CDN and Function bundle.
const assets=path.join(out,'static');await fs.mkdir(assets,{recursive:true});
for(const name of ['images','logo.png','app.js','styles.css','store.mjs','ui.mjs','admin.js','admin.css','access.js']){
 const source=path.join(root,'public',name);try{await fs.cp(source,path.join(assets,name),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const name of ['server','deployment'])await fs.cp(path.join(root,name),path.join(fn,name),{recursive:true});
await fs.mkdir(path.join(fn,'src'),{recursive:true});
for(const name of ['render.mjs','catalog.json','pages.json','hero-defaults.json'])await fs.copyFile(path.join(root,'src',name),path.join(fn,'src',name));
await fs.writeFile(path.join(fn,'package.json'),JSON.stringify({type:'module'}));
await fs.writeFile(path.join(fn,'.vc-config.json'),JSON.stringify({runtime:'nodejs22.x',handler:'deployment/vercel.mjs',launcherType:'Nodejs',maxDuration:30}));
await fs.writeFile(path.join(out,'config.json'),JSON.stringify({version:3,routes:[{handle:'filesystem'},{src:'/(.*)',dest:'/store'}]}));
console.log('Vercel Build Output API bundle created: Node function + public assets. No Next.js manifest required.');
