import {ApiError} from './catalogue.mjs';
export const emailAddress=value=>typeof value==='string'&&value.length<=160&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!/[\r\n]/.test(value);
export async function ownerEmail(env){
 const row=env.DB?await env.DB.prepare('SELECT owner_email FROM admin_credentials WHERE id=1').first():null;
 return String(row?.owner_email||env.ADMIN_EMAIL||'').trim().toLowerCase();
}
export async function mailSettings(env){
 const row=env.DB?await env.DB.prepare('SELECT payload FROM mail_settings WHERE id=1').first():null;
 let saved={};try{saved=JSON.parse(row?.payload||'{}')}catch{}
 const owner=await ownerEmail(env),defaultSender=env.MAIL_FROM||'Store <admin@mdkelectronics.com>';
 const match=/^(.*?)\s*<([^>]+)>$/.exec(defaultSender);
 const fromName=saved.fromName||match?.[1].trim()||'Store',fromEmail=saved.fromEmail||match?.[2]||'admin@mdkelectronics.com';
 return {ownerEmail:owner,fromName,fromEmail,sender:`${fromName} <${fromEmail}>`,notificationEmail:saved.notificationEmail||owner,notificationOverride:saved.notificationEmail||'',replyTo:saved.replyTo||owner};
}
export async function saveMailSettings(env,input){
 const fromName=String(input.fromName||'').trim(),fromEmail=String(input.fromEmail||'').trim().toLowerCase(),notificationEmail=String(input.notificationEmail||'').trim().toLowerCase(),replyTo=String(input.replyTo||'').trim().toLowerCase();
 if(!fromName||fromName.length>70||/[<>\r\n]/.test(fromName))throw new ApiError(400,'Use a sender name with 1–70 characters.');
 if(!emailAddress(fromEmail)||fromEmail.split('@')[1]!=='mdkelectronics.com')throw new ApiError(400,'The sender must use the verified mdkelectronics.com domain.');
 if(notificationEmail&&!emailAddress(notificationEmail)||replyTo&&!emailAddress(replyTo))throw new ApiError(400,'Enter valid email addresses.');
 await env.DB.prepare('INSERT INTO mail_settings (id,payload,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(JSON.stringify({fromName,fromEmail,notificationEmail,replyTo}),Date.now()).run();
 return mailSettings(env);
}
export async function recordMail(env,{purpose,recipient,status,providerId=null,error=null}){
 if(!env.DB)return;
 try{await env.DB.prepare('INSERT INTO email_activity (id,purpose,recipient,status,provider_id,last_error,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),purpose,recipient,status,providerId,error,Date.now()).run()}catch{console.error('Mail activity unavailable')}
}
