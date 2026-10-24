import {ApiError} from './catalogue.mjs';
export const emailAddress=value=>typeof value==='string'&&value.length<=160&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!/[\r\n]/.test(value);
export async function ownerEmail(env){
 let row=env.DB?await env.DB.prepare('SELECT owner_email,owner_transfer_id FROM admin_credentials WHERE id=1').first():null;
 // One-time hosting-owner configuration; public requests cannot provide these values.
 const target=String(env.ADMIN_OWNER_TRANSFER_EMAIL||'').trim().toLowerCase(),nonce=env.ADMIN_OWNER_TRANSFER_ID;
 if(env.DB&&emailAddress(target)&&/^[a-f0-9]{64}$/.test(nonce||'')&&row?.owner_transfer_id!==nonce){
  await env.DB.prepare('INSERT OR IGNORE INTO admin_credentials (id,revision) VALUES (1,0)').run();
  const pending='EXISTS (SELECT 1 FROM admin_credentials WHERE id=1 AND (owner_transfer_id IS NULL OR owner_transfer_id<>?))';
  await env.DB.batch([
   env.DB.prepare(`UPDATE email_outbox SET recipient=? WHERE status IN ('pending','failed') AND (id LIKE '%:owner' OR id LIKE '%:contact') AND ${pending}`).bind(target,nonce),
   env.DB.prepare(`INSERT INTO mail_settings (id,payload,updated_at) SELECT 1,json_set(COALESCE((SELECT payload FROM mail_settings WHERE id=1),'{}'),'$.notificationEmail',?,'$.replyTo',?),? WHERE ${pending} ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`).bind(target,target,Date.now(),nonce),
   env.DB.prepare('UPDATE admin_credentials SET owner_email=?,owner_transfer_id=?,revision=revision+1,reset_hash=NULL,reset_expires=NULL,reset_sent_at=NULL,pending_email=NULL,pending_email_hash=NULL,pending_email_expires=NULL WHERE id=1 AND (owner_transfer_id IS NULL OR owner_transfer_id<>?)').bind(target,nonce,nonce)
  ]);
  row=await env.DB.prepare('SELECT owner_email FROM admin_credentials WHERE id=1').first();
 }
 return String(row?.owner_email||env.ADMIN_EMAIL||'').trim().toLowerCase();
}
export async function mailSettings(env){
 const owner=await ownerEmail(env);
 const row=env.DB?await env.DB.prepare('SELECT payload FROM mail_settings WHERE id=1').first():null;
 let saved={};try{saved=JSON.parse(row?.payload||'{}')}catch{}
 const defaultSender=env.MAIL_FROM||'Store <admin@mdkelectronics.com>';
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
