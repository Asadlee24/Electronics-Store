import {escapeHTML as esc} from './catalogue.mjs';
const money=value=>'Rs. '+Number(value).toLocaleString('en-PK');
function layout({title,preview,body,footer='This is a service email about your store account or order request.'}){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;background:#f3f2ee;color:#202721;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td style="padding:0 0 24px;color:#6c786b;font-size:11px;letter-spacing:2px">STORE / NOTIFICATIONS</td></tr><tr><td style="background:#ffffff;border:1px solid #e3e6df;border-top:4px solid #354d39;border-radius:12px;padding:36px 30px">${body}</td></tr><tr><td style="padding:24px 8px;color:#7b8378;font-size:11px;line-height:1.8">${esc(footer)}<br><a href="https://www.mdkelectronics.com" style="color:#354d39">mdkelectronics.com</a></td></tr></table></td></tr></table></body></html>`;
}
const heading=text=>`<h1 style="font-size:28px;line-height:1.2;letter-spacing:-1px;margin:0 0 18px;font-weight:600">${esc(text)}</h1>`;
const p=text=>`<p style="font-size:14px;line-height:1.8;color:#697366;margin:12px 0">${esc(text)}</p>`;
const button=(text,url)=>`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:#354d39;border-radius:6px"><a href="${esc(url)}" style="display:inline-block;padding:15px 24px;color:#fff;text-decoration:none;font-size:14px">${esc(text)} →</a></td></tr></table>`;
export function passwordEmail(url){
 const link=new URL(url);if(!['mdkelectronics.com','www.mdkelectronics.com','electronics-store-eight-sigma.vercel.app'].includes(link.hostname)||link.protocol!=='https:'||link.pathname!=='/admin/reset')throw Error('Invalid recovery URL');
 const subject='Set your store password';
 return {subject,text:`Set your store password\n\nOpen this private link within 15 minutes:\n${url}\n\nThe link works once. Changing your password signs out existing sessions. If you did not request this, ignore this email.`,html:layout({title:subject,preview:'Your private password link. Valid for 15 minutes.',body:`<span style="font-size:11px;color:#7e8b78;letter-spacing:2px">PRIVATE ACCESS</span>${heading('A fresh start.')} ${p('Use the button below to set or reset your store password. This private link expires in 15 minutes and works once.')}${button('Set my password',url)}${p('Changing your password signs out existing sessions. If you did not request this, you can ignore this email.')}`})};
}
export function orderEmail(order,{owner=false}={}){
 const subject=owner?`New request · ${order.reference}`:`Your request · ${order.reference}`;
 const lines=order.items.map(i=>`${i.quantity} × ${i.name} — ${money(i.total)}`);
 const rows=order.items.map(i=>`<tr><td style="padding:14px 0;border-bottom:1px solid #eceee8;font-size:13px;line-height:1.7">${esc(i.name)}<br><span style="color:#89917f">Qty ${i.quantity}</span></td><td align="right" style="padding:14px 0;border-bottom:1px solid #eceee8;font-size:13px;white-space:nowrap">${esc(money(i.total))}</td></tr>`).join('');
 const title=owner?'A new order request.':'We have your request.';
 return {subject,text:[title,order.reference,'',...lines,'',`Product subtotal: ${money(order.subtotal)}`,'Delivery and payment are not confirmed. The store will contact the customer to confirm availability and the final total.',...(owner?['',`Customer: ${order.customer.name}`,`Phone: ${order.customer.phone}`,`City: ${order.customer.city}`]:[])].join('\n'),html:layout({title:subject,preview:`${order.reference} · ${money(order.subtotal)} · Pending confirmation`,body:`<span style="font-size:11px;color:#7e8b78;letter-spacing:2px">${esc(order.reference)}</span>${heading(title)}${p(owner?'Review the items and contact the customer to confirm availability and delivery.':`Hi ${order.customer.name}, your request is saved. Our team will confirm availability, delivery charges and payment with you.`)}<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}<tr><td style="padding-top:20px;font-size:13px">Product subtotal</td><td align="right" style="padding-top:20px;font-size:18px;font-weight:bold">${esc(money(order.subtotal))}</td></tr></table>${owner?p(`${order.customer.name} · ${order.customer.phone} · ${order.customer.city}`):''}${p('Pending confirmation. No payment has been taken.')}${button(owner?'Open order requests':'Visit the store',owner?'https://www.mdkelectronics.com/admin/#orders':'https://www.mdkelectronics.com')}`})};
}
export async function sendEmail(env,to,message,id){
 if(!env.RESEND_API_KEY)throw Error('Email is not configured');
 const fetcher=env.MAIL_FETCH||fetch;
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:env.MAIL_FROM||'Store <admin@mdkelectronics.com>',to:[to],...message}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Email provider did not accept the message');
 const data=await response.json();if(!data.id)throw Error('Email provider response was incomplete');return data.id;
}
export async function queueOrderEmails(env,order,id){
 if(!env.RESEND_API_KEY)return;
 for(const [kind,to] of [['owner',env.ADMIN_EMAIL],['customer',order.customer.email]]){
  if(!to)continue;
  await env.DB.prepare("INSERT OR IGNORE INTO email_outbox (id,recipient,payload,status,created_at,attempts) VALUES (?,?,?,'pending',?,0)").bind(`${id}:${kind}`,to,JSON.stringify(orderEmail(order,{owner:kind==='owner'})),Date.now()).run();
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
  try{const providerId=await sendEmail(env,row.recipient,JSON.parse(row.payload),'store-order-'+row.id);await env.DB.prepare("UPDATE email_outbox SET status='accepted',provider_id=?,last_error=NULL WHERE id=?").bind(providerId,row.id).run();}
  catch{await env.DB.prepare("UPDATE email_outbox SET status='failed',last_error='Provider did not accept the email',next_attempt=? WHERE id=?").bind(now+60000,row.id).run();}
 }
}
