import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import handler from '../api/voucher-email.js';
const fetchBefore=globalThis.fetch,transportBefore=nodemailer.createTransport,envBefore={...process.env};
let status,body,calls=[],mail=null,mode='ok',config;
const res={status(s){status=s;return this;},setHeader(){},json(v){body=v;return this;}};
const id='00000000-0000-0000-0000-000000000001';
const request={method:'POST',headers:{authorization:'Bearer mock-token'},body:{voucherId:id,to:'untrusted@example.test'}};
try{
 delete process.env.VOUCHER_SMTP_PASSWORD;
 await handler({method:'POST',headers:{}},res);assert.equal(status,401);
 await handler(request,res);assert.equal(status,503);
 Object.assign(process.env,{VOUCHER_SMTP_HOST:'smtp.example.test',VOUCHER_SMTP_PORT:'465',VOUCHER_SMTP_USER:'sender@example.test',VOUCHER_SMTP_PASSWORD:'mock-only-password',VOUCHER_FROM_EMAIL:'sender@example.test',VOUCHER_MAIL_SIGNING_SECRET:'mock-server-secret',SUPABASE_URL:'https://supabase.example.test'});
 globalThis.fetch=async (url,options)=>{
  const action=JSON.parse(options.body);calls.push(action);
  assert.equal(options.headers['x-voucher-mail-secret'],'mock-server-secret');
  if(action.action==='email-result')return new Response(JSON.stringify({recorded:true}));
  if(mode==='denied')return new Response(JSON.stringify({error:'Non autorizzato'}),{status:403});
  if(mode==='already')return new Response(JSON.stringify({alreadySent:true}));
  return new Response(JSON.stringify({ticket:'attempt',voucher:{id,recipient_email:'center@example.test',recipient_name:'Centro',package_name:'Promo',course_titles:['Video A','Video B'],code:'ODR-TEST'}}));
 };
 nodemailer.createTransport=options=>{config=options;return {sendMail:async value=>{if(mode==='smtp-error')throw Error('Mock failure');mail=value;return {accepted:[value.to]};},close(){}};};
 await handler(request,res);assert.equal(status,200);assert.equal(mail.to,'center@example.test');assert(mail.text.includes('Video B'));assert(mail.text.includes('ODR-TEST'));assert(mail.text.includes('https://www.ita318academy.it/materiale?paid=1'));assert.equal(config.secure,true);assert.equal(config.requireTLS,true);assert.equal(calls.at(-1).sent,true);
 mode='already';mail=null;await handler(request,res);assert.equal(status,200);assert.equal(mail,null);
 mode='denied';await handler(request,res);assert.equal(status,403);assert.equal(mail,null);
 mode='smtp-error';await handler(request,res);assert.equal(status,502);assert.equal(calls.at(-1).sent,false);
 console.log('Voucher email: authentication, missing configuration, fixed recipient, TLS, server-only delivery receipt, duplicate guard and failed delivery reporting OK (no real email sent)');
}finally{globalThis.fetch=fetchBefore;nodemailer.createTransport=transportBefore;for(const key of Object.keys(process.env))if(!(key in envBefore))delete process.env[key];Object.assign(process.env,envBefore);}
