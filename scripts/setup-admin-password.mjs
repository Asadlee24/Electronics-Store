#!/usr/bin/env node
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {stdin,stdout} from 'node:process';
if(!stdin.isTTY||!stdin.setRawMode){console.error('Use an interactive terminal.');process.exit(1)}
const ask=prompt=>new Promise(resolve=>{
 stdout.write(prompt);let value='';stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
 const read=chunk=>{for(const c of chunk){if(c==='\u0003'){stdin.setRawMode(false);process.exit(130)}if(c==='\r'||c==='\n'){stdin.off('data',read);stdin.setRawMode(false);stdout.write('\n');resolve(value);return}if(c==='\u007f'||c==='\b'){value=value.slice(0,-1)}else if(c>=' '&&c!=='\u007f'){value+=c}}};
 stdin.on('data',read);
});
try{
 const password=await ask('New admin password (minimum 12 characters): ');
 if(password.length<12||password.length>256)throw Error('Password must have 12–256 characters.');
 const confirm=await ask('Confirm admin password: ');
 if(password!==confirm)throw Error('Passwords do not match.');
 const salt=randomBytes(16),hash=pbkdf2Sync(password,salt,250000,32,'sha256');
 console.log('\nSave these as Sites runtime secrets, never in GitHub:');
 console.log('ADMIN_PASSWORD_HASH='+salt.toString('hex')+':'+hash.toString('hex'));
 console.log('ADMIN_SESSION_SECRET='+randomBytes(32).toString('hex'));
 console.log('\nRepublish Sites after storing the secrets.');
}catch(e){console.error(e.message);process.exitCode=1}finally{if(stdin.isTTY)stdin.setRawMode(false);stdin.pause()}
