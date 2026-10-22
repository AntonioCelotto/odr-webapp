import nodemailer from 'nodemailer';
export default async function handler(req,res){
 const json=(s,v)=>{res.status(s);res.setHeader('Cache-Control','private, no-store');res.json(v);};
 if(req.method!=='POST')return json(405,{error:'Metodo non consentito'});
 const auth=req.headers.authorization||'';if(!/^Bearer\s+\S+$/.test(auth))return json(401,{error:'Accesso richiesto'});
 const {VOUCHER_SMTP_HOST:host,VOUCHER_SMTP_PORT:port,VOUCHER_SMTP_USER:user,VOUCHER_SMTP_PASSWORD:pass,VOUCHER_FROM_EMAIL:from,VOUCHER_MAIL_SIGNING_SECRET:signingSecret}=process.env;
 if(!host||!port||!user||!pass||!from||!signingSecret)return json(503,{error:'Mittente email non ancora configurato'});
 let ticket,voucherId,transport;
 const edge=async body=>{
  const r=await fetch(`${process.env.SUPABASE_URL}/functions/v1/voucher-management`,{method:'POST',headers:{Authorization:auth,apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json','x-voucher-mail-secret':signingSecret},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  return {status:r.status,ok:r.ok,data:await r.json()};
 };
 try{
  voucherId=String(req.body?.voucherId||'');
  if(!/^[0-9a-f-]{36}$/i.test(voucherId))return json(400,{error:'Voucher non valido'});
  // The edge function verifies the ODR identity/ownership, then atomically reserves
  // a delivery attempt. Recipient and message content never come from the request.
  const claim=await edge({action:'email-ticket',voucherId});
  if(!claim.ok)return json(claim.status,{error:claim.data.error||'Invio non disponibile'});
  if(claim.data.alreadySent)return json(200,{sent:true,alreadySent:true});
  ticket=claim.data.ticket;const v=claim.data.voucher;
  if(!ticket||!v?.recipient_email)return json(409,{error:'Email non disponibile'});
  transport=nodemailer.createTransport({host,port:Number(port),secure:Number(port)===465,requireTLS:true,auth:{user,pass},connectionTimeout:8000,greetingTimeout:8000,socketTimeout:12000,tls:{minVersion:'TLSv1.2'},logger:false,debug:false});
  const info=await transport.sendMail({from:{name:'ITA318 Academy',address:from},replyTo:from,to:v.recipient_email,
   subject:'Il tuo voucher per i videocorsi ITA318 Academy',
   text:`Gentile ${v.recipient_name},\n\na seguito dell’acquisto del pacchetto ${v.package_name}, ti è stato assegnato il voucher:\n\n${v.code}\n\nVideocorsi inclusi:\n${v.course_titles.map(t=>'• '+t).join('\n')}\n\nRegistrati o accedi su https://www.ita318academy.it/materiale?paid=1, entra in “Corsi a pagamento”, inserisci il codice e premi “Attiva voucher”.\n\nNon sono richiesti ulteriori pagamenti. Il voucher è utilizzabile una sola volta su un solo account.\n\nITA318 Academy`,
   messageId:`<voucher-${v.id}-${ticket}@${from.split('@')[1]}>`,disableFileAccess:true,disableUrlAccess:true});
  if(!info.accepted?.length)throw Error('Delivery rejected');
  const recorded=await edge({action:'email-result',voucherId,ticket,sent:true});
  if(!recorded.ok)return json(502,{error:'Email inviata, aggiornamento dello stato in attesa.'});
  return json(200,{sent:true});
 }catch{
  if(ticket)await edge({action:'email-result',voucherId,ticket,sent:false}).catch(()=>{});
  return json(502,{error:'Email non inviata. Controlla le credenziali SMTP o riprova tra due minuti.'});
 }finally{transport?.close();}
}
