#!/usr/bin/env node
// Run locally: node scripts/setup-admin-password.mjs
// The password never appears in source code or Git history.
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {createInterface} from 'node:readline';
import {stdin,stdout} from 'node:process';
if(!stdin.isTTY){console.error('Run in an interactive terminal so the password is not passed as an argument.');process.exit(1)}
const rl=createInterface({input:stdin,output:stdout,terminal:true});
const ask=(question)=>new Promise(resolve=>{let password='';stdout.write(question);const handler=char=>{if(char==='\n'||char==='\r'){stdin.off('data',handler);stdout.write('\n');resolve(password)}else if(char==='\u007f'){password=password.slice(0,-1)}else if(char==='\u0003'){process.exit(130)}else{password+=char}};stdin.on('data',handler);});
try{
 // readline retains terminal input handling; turn off output echo for password entry.
 const password=await ask('New admin password (minimum 12 characters): ');
 if(password.length<12||password.length>256)throw Error('Password must have 12–256 characters.');
 const confirm=await ask('Confirm admin password: ');
 if(password!==confirm)throw Error('Passwords do not match.');
 const salt=randomBytes(16),hash=pbkdf2Sync(password,salt,250000,32,'sha256');
 console.log('\nCopy these TWO values into the Sites runtime secrets (NOT GitHub or browser):');
 console.log('ADMIN_PASSWORD_HASH='+salt.toString('hex')+':'+hash.toString('hex'));
 console.log('ADMIN_SESSION_SECRET='+randomBytes(32).toString('hex'));
 console.log('\nDo not share these secrets. Republish the Sites backend after configuration.');
}catch(e){console.error(e.message);process.exitCode=1}finally{rl.close()}
