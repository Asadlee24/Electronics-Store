import {Buffer} from 'node:buffer';
import bank from '../src/bank.json' with {type:'json'};
import {ApiError,text,imageType} from './catalogue.mjs';
import {digest} from './admin-auth.mjs';
export const MAX_PROOF_BYTES=2*1024*1024;
export function validatePayment(input){
 if(!input||input.method==='whatsapp')return {payment:{method:'whatsapp',status:'unpaid'}};
 if(input.method!=='bank')throw new ApiError(400,'Choose a payment method.');
 if(typeof input.proof!=='string'||input.proof.length>Math.ceil(MAX_PROOF_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.proof))throw new ApiError(400,'Upload a JPG, PNG or WebP payment proof up to 2 MB.');
 const bytes=Buffer.from(input.proof,'base64'),type=imageType(bytes);
 if(bytes.length<20||bytes.length>MAX_PROOF_BYTES||!type||bytes.toString('base64')!==input.proof)throw new ApiError(400,'Upload a valid JPG, PNG or WebP payment proof up to 2 MB.');
 return {bytes,type,payment:{method:'bank',status:'under_review',bank:{...bank},senderName:text(input.senderName||'','Sender name',100,false),transactionRef:text(input.transactionRef||'','Transaction reference',100,false)}};
}
export async function storePaymentProof(env,id,validated){
 if(!validated.bytes)return validated.payment;
 if(!env.BUCKET)throw new ApiError(503,'Proof upload is unavailable. Contact the store before paying.');
 const key='payment-proofs/'+id;
 await env.BUCKET.put(key,validated.bytes,{httpMetadata:{contentType:validated.type.mime}});
 return {...validated.payment,proof:{key,mime:validated.type.mime,extension:validated.type.extension,size:validated.bytes.length,hash:await digest(validated.bytes),uploadedAt:new Date().toISOString()}};
}
export function publicOrderResult(order){return {reference:order.reference,paymentStatus:order.payment?.status||'unpaid',proofReceived:Boolean(order.payment?.proof)};}
