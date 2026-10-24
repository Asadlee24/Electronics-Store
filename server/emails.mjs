import {Buffer} from 'node:buffer';
import {escapeHTML as esc} from './catalogue.mjs';
import {mailSettings,recordMail} from './mail-settings.mjs';
const money=value=>'Rs. '+Number(value).toLocaleString('en-PK');
function layout({title,preview,body,footer='This is a service email about your store account or order request.'}){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#f3f2ee;color:#202721;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td bgcolor="#20392b" style="padding:24px 30px;background:#20392b;border-radius:12px 12px 0 0"><a href="https://mdkelectronics.com"><img src="https://mdkelectronics.com/images/logo.png" alt="MDK Electronics" width="240" height="68" style="display:block;width:240px;max-width:100%;height:auto;border:0"></a><p style="margin:14px 0 0;color:#dbe4d4;font-size:11px;letter-spacing:2px">STORE NOTIFICATIONS</p></td></tr><tr><td style="background:#ffffff;border:1px solid #e3e6df;border-top:4px solid #f5d34d;border-radius:0 0 12px 12px;padding:36px 30px">${body}</td></tr><tr><td style="padding:24px 8px;color:#7b8378;font-size:11px;line-height:1.8">${esc(footer)}<br><a href="https://www.mdkelectronics.com" style="color:#354d39">mdkelectronics.com</a></td></tr></table></td></tr></table></body></html>`;
}
const heading=text=>`<h1 style="font-size:28px;line-height:1.2;letter-spacing:-1px;margin:0 0 18px;font-weight:600">${esc(text)}</h1>`;
const p=text=>`<p style="font-size:14px;line-height:1.8;color:#697366;margin:12px 0">${esc(text)}</p>`;
const button=(text,url)=>`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:#354d39;border-radius:6px"><a href="${esc(url)}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-size:14px">${esc(text)} →</a></td></tr></table>`;
export function passwordEmail(url){
 const link=new URL(url);if(!['mdkelectronics.com','www.mdkelectronics.com','electronics-store-eight-sigma.vercel.app'].includes(link.hostname)||link.protocol!=='https:'||link.pathname!=='/admin/reset')throw Error('Invalid recovery URL');
 const subject='Set your store password';
 return {subject,text:`Set your store password\n\nOpen this private link within 15 minutes:\n${url}\n\nThe link works once. Changing your password signs out existing sessions. If you did not request this, ignore this email.`,html:layout({title:subject,preview:'Your private password link. Valid for 15 minutes.',body:`<span style="font-size:11px;color:#7e8b78;letter-spacing:2px">PRIVATE ACCESS</span>${heading('A fresh start.')} ${p('Use the button below to set or reset your store password. This private link expires in 15 minutes and works once.')}${button('Set my password',url)}${p('Changing your password signs out existing sessions. If you did not request this, you can ignore this email.')}`})};
}
export function orderEmail(order,{owner=false,status=null}={}){
 const bankTransfer=['bank','easypaisa'].includes(order.payment?.method);const paymentText=bankTransfer?`${order.payment.method==='easypaisa'?'Easypaisa':'Bank transfer'}: ${order.payment.status.replaceAll('_',' ')}. ${order.payment.bank.bank} · ${order.payment.bank.accountTitle} · ${order.payment.bank.accountNumber}. ${order.payment.status==='verified'?'Transfer verified by the store.':order.payment.status==='rejected'?'Transfer not verified. Contact the store.':'Proof received; the store must verify the transfer.'}`:'Payment is not recorded. Confirm payment with the store.';
 const subject=status?`Order request ${status} · ${order.reference}`:owner?`${bankTransfer?'Payment proof received':'New request'} · ${order.reference}`:`Your request · ${order.reference}`;
 const lines=order.items.map(i=>`${i.quantity} × ${i.name} — ${money(i.total)}`);
 const rows=order.items.map(i=>`<tr><td style="padding:14px 0;border-bottom:1px solid #eceee8;font-size:13px;line-height:1.7">${esc(i.name)}<br><span style="color:#89917f">Qty ${i.quantity}</span></td><td align="right" style="padding:14px 0;border-bottom:1px solid #eceee8;font-size:13px;white-space:nowrap">${esc(money(i.total))}</td></tr>`).join('');
 const title=status?'Your request is '+status+'.':owner?'A new order request.':'We have your request.';
 return {subject,text:[title,order.reference,'',...lines,'',`Product subtotal: ${money(order.subtotal)}`,paymentText,status?'Contact the store for payment or delivery details.': 'Delivery and payment are not confirmed. The store will contact the customer to confirm availability and the final total.',...(owner?['',`Customer: ${order.customer.name}`,`Phone: ${order.customer.phone}`,`City: ${order.customer.city}`,`Address: ${order.customer.address}`,`Email: ${order.customer.email||'Not provided'}`,`Notes: ${order.customer.notes||'None'}`]:[])].join('\n'),html:layout({title:subject,preview:`${order.reference} · ${money(order.subtotal)} · ${status||'Pending confirmation'}`,body:`<span style="font-size:11px;color:#7e8b78;letter-spacing:2px">${esc(order.reference)}</span>${heading(title)}${p(status?'The store updated this request to '+status+'. Contact the store with any questions.':owner?'Review the items and contact the customer to confirm availability and delivery.':`Hi ${order.customer.name}, your request is saved. Our team will confirm availability, delivery charges and payment with you.`)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}<tr><td style="padding-top:20px;font-size:13px">Product subtotal</td><td align="right" style="padding-top:20px;font-size:18px;font-weight:bold">${esc(money(order.subtotal))}</td></tr></table>${p(paymentText)}${owner?p(`${order.customer.name} · ${order.customer.phone} · ${order.customer.city}`)+p(order.customer.address)+p(order.customer.email||'No customer email')+p(order.customer.notes||''):''}${p(bankTransfer?(order.payment.status==='verified'?'The store verified your transfer.':order.payment.status==='rejected'?'Please contact the store about your transfer.':'Your proof is received. The transfer is pending the store’s verification.'):status?'Payments are handled directly with the store.':'Pending confirmation. No payment has been taken.')}${button(owner?'Open order requests':'Visit the store',owner?'https://mdkelectronics.com/admin/#orders':'https://www.mdkelectronics.com')}`})};
}
export async function sendEmail(env,to,message,id,purpose='notification'){
 if(!env.RESEND_API_KEY)throw Error('Email is not configured');
 const fetcher=env.MAIL_FETCH||fetch,settings=await mailSettings(env);
 const {proofAttachment,...outbound}=message;
 if(proofAttachment){
  if(!/^payment-proofs\/[a-f0-9-]{36}$/.test(proofAttachment.key)||!['image/jpeg','image/png','image/webp'].includes(proofAttachment.mime))throw Error('Invalid proof attachment');
  const object=await env.BUCKET?.get(proofAttachment.key);if(!object)throw Error('Payment proof attachment unavailable');
  const bytes=Buffer.from(await object.arrayBuffer());if(bytes.length>2*1024*1024)throw Error('Payment proof attachment too large');
  outbound.attachments=[{filename:proofAttachment.filename,content:bytes.toString('base64')}];
 }
 let response;try{response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:settings.sender,to:[to],reply_to:settings.replyTo,...outbound}),signal:AbortSignal.timeout(10000)})}catch{await recordMail(env,{purpose,recipient:to,status:'failed',error:'Email provider could not be reached'});throw Error('Email provider could not be reached');}
 if(!response.ok){let name='request_failed';try{const body=await response.json();if(/^[a-z_]{1,60}$/.test(body.name))name=body.name}catch{}
  const safe='Email provider error '+response.status+' ('+name+')';await recordMail(env,{purpose,recipient:to,status:'failed',error:safe});throw Error(safe);}
 const data=await response.json();if(!data.id)throw Error('Email provider response was incomplete');await recordMail(env,{purpose,recipient:to,status:'accepted',providerId:data.id});return data.id;
}
export async function queueOrderEmails(env,order,id){
 if(!env.RESEND_API_KEY)return;
 const settings=await mailSettings(env);
 for(const [kind,to] of [['owner',settings.notificationEmail],['customer',order.customer.email]]){
  if(!to)continue;
  await env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,recipient,payload,status,created_at,attempts) VALUES (?,?,?,'pending',?,0)").bind(`${id}:${kind}`,to,JSON.stringify({...orderEmail(order,{owner:kind==='owner'}),...(kind==='owner'&&order.payment?.proof?{proofAttachment:{key:order.payment.proof.key,mime:order.payment.proof.mime,filename:order.reference+'-payment-proof.'+order.payment.proof.extension}}:{})}),Date.now()).run();
 }
}
export async function flushEmails(env){
 if(!env.RESEND_API_KEY)return;
 const now=Date.now();
 await env.DB.prepare("UPDATE email_outbox SET status='pending' WHERE status='sending' AND next_attempt<? AND created_at>?").bind(now,now-23*3600000).run();
 const rows=await env.DB.prepare("SELECT * FROM email_outbox WHERE status IN ('pending','failed') AND attempts<5 AND created_at>? AND (next_attempt IS NULL OR next_attempt<=?) ORDER BY created_at LIMIT 10").bind(now-23*3600000,now).all();
 for(const row of rows.results||[]){
  // Atomic claim prevents concurrent checkout and retry handlers sending twice.
  const claimed=await env.DB.prepare("UPDATE email_outbox SET status='sending',attempts=attempts+1,next_attempt=? WHERE id=? AND status IN ('pending','failed')").bind(now+60000,row.id).run();if(!claimed.meta.changes)continue;
  try{const providerId=await sendEmail(env,row.recipient,JSON.parse(row.payload),'store-order-'+row.id,row.id.endsWith(':contact')?'contact':row.id.includes(':payment:')?'payment-review':'order');await env.DB.prepare("UPDATE email_outbox SET status='accepted',provider_id=?,last_error=NULL WHERE id=?").bind(providerId,row.id).run();}
  catch(error){await env.DB.prepare("UPDATE email_outbox SET status='failed',last_error=?,next_attempt=? WHERE id=?").bind(/^Email provider error \d{3} \([a-z_]+\)$/.test(error.message)?error.message:'Provider did not accept the email',now+60000,row.id).run();}
 }
}

export function verificationEmail(url){
 const link=new URL(url);if(!['mdkelectronics.com','www.mdkelectronics.com','electronics-store-eight-sigma.vercel.app'].includes(link.hostname)||link.protocol!=='https:'||link.pathname!=='/admin/verify-email')throw Error('Invalid owner verification URL');
 return {subject:'Verify your store owner email',text:`The current store admin requested this owner email change. Open this private link within 15 minutes to confirm:\n${url}\n\nThe old password will stop working and all sessions will be signed out. After confirming, use password recovery to choose your own password. If this was not requested, ignore this email.`,html:layout({title:'Verify your store owner email',preview:'Confirm the store owner email change within 15 minutes.',body:heading('Confirm your email.')+p('The current admin requested an owner email change. Confirm only if you expect to manage this store.')+button('Confirm owner email',url)+p('This link works once within 15 minutes. Existing sessions and the old password stop working. After confirming, use password recovery to choose your own password. Ignore this email if you did not expect it.')})};
}
export function testEmail(){return {subject:'Store email connection test',text:'Your store can send transactional email through Resend. This is a test requested from the admin Email settings.',html:layout({title:'Store email connection test',preview:'A test from your store workspace.',body:heading('Email is connected.')+p('This test was requested from your store workspace. Your mail provider accepted the connection.')})};}
export async function queueStatusEmails(env,order,id){
 if(!env.RESEND_API_KEY)return;
 const settings=await mailSettings(env);
 for(const [kind,to] of [['owner',settings.notificationEmail],['customer',order.customer.email]]){
  if(!to)continue;
  const message=orderEmail(order,{owner:kind==='owner',status:order.status});
  await env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,recipient,payload,status,created_at,attempts) VALUES (?,?,?,'pending',?,0)").bind(`${id}:${kind}`,to,JSON.stringify(message),Date.now()).run();
 }
}

export function paymentReviewEmail(order,{owner=false}={}){
 const status=order.payment.status,subject=`Payment ${status} · ${order.reference}`,note=order.payment.reviewNote||'';
 const provider=order.payment.method==='easypaisa'?'Easypaisa':'bank';const content=status==='verified'?`The store has verified the ${provider} transfer.`:`The store could not verify the ${provider} transfer. Please contact the store with your order reference.`;
 return {subject,text:[order.reference,content,note,`Order subtotal: ${money(order.subtotal)}`,'Delivery and dispatch are confirmed separately by the store.'].filter(Boolean).join('\n'),html:layout({title:subject,preview:subject,body:heading(status==='verified'?'Payment verified.':'Payment needs attention.')+p(order.reference)+p(content)+(note?p(note):'')+p('Order subtotal: '+money(order.subtotal))+p('Delivery and dispatch are confirmed separately by the store.')+button(owner?'Review order':'Contact the store',owner?'https://mdkelectronics.com/admin/#orders':'https://mdkelectronics.com/contact-us/')})};
}
