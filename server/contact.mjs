import {ApiError,text,escapeHTML as esc} from './catalogue.mjs';
import {emailAddress,mailSettings} from './mail-settings.mjs';
export function validateContact(input){
 const name=text(input.name,'Your name',100),email=text(input.email,'Email address',160).toLowerCase(),phone=text(input.phone||'','Phone number',22,false),subject=text(input.subject,'Subject',100),message=text(input.message,'Message',3000);
 if(!emailAddress(email))throw new ApiError(400,'Enter a valid email address.');
 if(phone&&!/^[+0-9 ()-]{7,22}$/.test(phone))throw new ApiError(400,'Enter a valid phone number or leave it blank.');
 if(message.length<20)throw new ApiError(400,'Please include at least 20 characters in your message.');
 if(input.consent!==true)throw new ApiError(400,'Please agree to the privacy policy.');
 return {name,email,phone,subject,message};
}
export async function saveContact(env,input,clientId){
 if(typeof input.requestId!=='string'||!/^[-a-f0-9]{36}$/.test(input.requestId))throw new ApiError(400,'Invalid message reference.');
 if(input.website)return {saved:true,reference:'THANK-YOU'};
 const message=validateContact(input),payload=JSON.stringify(message);
 const previous=await env.DB.prepare('SELECT client_id,reference,payload FROM contact_messages WHERE id=?').bind(input.requestId).first();
 if(previous&& (previous.client_id!==clientId||previous.payload!==payload))throw new ApiError(409,'Use a new message reference.');
 let reference=previous?.reference;
 if(!previous){
 const since=new Date(Date.now()-20*60000).toISOString(),recent=await env.DB.prepare('SELECT count(*) as count FROM contact_messages WHERE client_id=? AND created_at>?').bind(clientId,since).first();
 if(recent.count>=3)throw new ApiError(429,'Please wait before sending another message. You can contact us on WhatsApp meanwhile.');
 reference='MDK-M-'+crypto.randomUUID().slice(0,8).toUpperCase();
 await env.DB.prepare('INSERT INTO contact_messages (id,client_id,reference,payload,created_at) VALUES (?,?,?,?,?)').bind(input.requestId,clientId,reference,payload,new Date().toISOString()).run();
 }
 const settings=await mailSettings(env);
 const email=contactEmail({...message,reference});
 await env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,recipient,payload,status,created_at,attempts) VALUES (?,?,?,'pending',?,0)").bind(input.requestId+':contact',settings.notificationEmail,JSON.stringify(email),Date.now()).run();
 return {saved:true,reference};
}
export function contactEmail(message){
 return {subject:'New website message · '+message.reference,reply_to:message.email,text:[message.reference,`From: ${message.name}`,`Email: ${message.email}`,`Phone: ${message.phone||'Not provided'}`,`Subject: ${message.subject}`,'',message.message].join('\n'),html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New website message</title></head><body style="margin:0;background:#f3f2ee;font-family:Arial,Helvetica,sans-serif;color:#203528"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:30px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td style="background:#20392b;padding:24px;border-radius:12px 12px 0 0"><img src="https://mdkelectronics.com/images/logo.png" alt="MDK Electronics" width="240" height="68" style="width:240px;max-width:100%;height:auto;display:block"></td></tr><tr><td style="background:white;padding:30px;border-top:4px solid #f5d34d;border-radius:0 0 12px 12px"><p style="font-size:12px;color:#75816b">${esc(message.reference)}</p><h1 style="font-size:26px">A new message.</h1><p style="font-size:15px;line-height:1.8"><strong>${esc(message.name)}</strong><br>${esc(message.email)}<br>${esc(message.phone||'')}</p><h2 style="font-size:18px">${esc(message.subject)}</h2><p style="font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere">${esc(message.message)}</p><p style="font-size:13px;color:#75816b">Reply to this email to contact the sender.</p><a href="https://mdkelectronics.com/admin/#messages" style="display:inline-block;background:#354d39;color:white;padding:15px 20px;border-radius:6px;text-decoration:none;font-size:14px">View messages</a></td></tr></table></td></tr></table></body></html>`};
}
