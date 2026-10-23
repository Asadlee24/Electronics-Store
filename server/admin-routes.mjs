import {ApiError,requireSameOrigin} from './catalogue.mjs';
import {adminContext,adminSession,signIn,signOut,requestReset,resetPassword} from './admin-auth.mjs';
import {accessPage} from './access-page.mjs';
import {adminPage} from './admin-page.mjs';
import {passwordEmail,sendEmail} from './emails.mjs';
const html=(body,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
const redirect=(location,cookie)=>new Response(null,{status:303,headers:{Location:location,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
export async function adminRoute(request,env){
 const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
 if(path!=='/admin'&&!path.startsWith('/admin/'))return null;
 let mode=path==='/admin/reset'?'reset':path==='/admin/forgot'||path==='/admin/request-reset'?'forgot':'login',recoveryToken=url.searchParams.get('token')||'';
 try{
  await adminContext(request,env);
  if(request.method==='POST'){
   requireSameOrigin(request);
   if(!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded'))throw new ApiError(415,'Use the sign-in form.');
   const raw=await request.text();if(raw.length>8000)throw new ApiError(413,'Form is too large.');
   const form=new URLSearchParams(raw);
   if(mode==='reset')recoveryToken=/^[a-f0-9]{64}$/.test(form.get('token')||'')?form.get('token'):'';
   if(path==='/admin/login')return redirect('/admin/',await signIn(new Request(request,{body:raw}),env,form));
   if(path==='/admin/logout')return redirect('/admin/',await signOut(new Request(request,{body:raw}),env));
   if(path==='/admin/request-reset'){
    await requestReset(new Request(request,{body:raw}),env,form,async({to,url,id})=>sendEmail(env,to,passwordEmail(url),'store-reset-'+id));
    return html(accessPage({mode:'sent'}));
   }
   if(path==='/admin/reset')return redirect('/admin/?password=updated',await resetPassword(new Request(request,{body:raw}),env,form));
   throw new ApiError(404,'Page not found.');
  }
  if(!['GET','HEAD'].includes(request.method))throw new ApiError(405,'Method not allowed.');
  if(path==='/admin/forgot')return html(accessPage({mode:'forgot'}));
  if(path==='/admin/reset')return html(accessPage({mode:'reset',token:/^[a-f0-9]{64}$/.test(url.searchParams.get('token')||'')?url.searchParams.get('token'):''}));
  if(path!=='/admin')throw new ApiError(404,'Page not found.');
  if(await adminSession(request,env))return html(adminPage());
  return html(accessPage({message:url.searchParams.get('password')==='updated'?'Password saved. Sign in with your new password.':''}));
 }catch(error){
  // A Sites visitor still needs the platform owner identity. Vercel presents
  // only the app password form, using the signed server gateway instead.
  if(!request.headers.has('x-store-admin-signature')&&error.status===401&&!request.headers.has('oai-authenticated-user-id'))return html(accessPage({mode:'unavailable',message:'Open the private owner site and sign in to access its admin.'}),401);
  const message=error instanceof ApiError?error.message:'The admin is temporarily unavailable. Please try again shortly.';
  return html(accessPage({mode,message,error:true,token:mode==='reset'?recoveryToken:''}),error.status||503);
 }
}
