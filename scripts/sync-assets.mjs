import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
if((await fs.readdir(path.join(root,"public"))).some(name=>name.startsWith("__qa-")))throw new Error("Remove temporary public QA fixtures before building.");
for(const file of ['app.js','styles.css','store.mjs','admin.js','admin.css'])await fs.copyFile(path.join(root,'src',file),path.join(root,'public',file));
const render=await fs.readFile(path.join(root,'src/render.mjs'),'utf8');
await fs.writeFile(path.join(root,'public/ui.mjs'),render.slice(0,render.indexOf('const pill =')));
