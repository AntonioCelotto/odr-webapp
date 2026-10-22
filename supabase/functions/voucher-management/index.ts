import {createClient} from 'npm:@supabase/supabase-js@2.110.8';
import {contact,plans} from './model.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async req=>{
 const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:cors});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(!['GET','POST'].includes(req.method))return json({error:'Metodo non consentito'},405);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const auth=req.headers.get('Authorization')||'',token=auth.replace(/^Bearer\s+/i,'');
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)return json({error:'Sessione non valida'},401);
 const {data:p}=await db.from('profiles').select('id,role,approval_status').eq('id',user.id).single();
 if(!p||p.approval_status!=='approved'||!['admin','agent','distributor'].includes(p.role))return json({error:'Profilo non autorizzato'},403);
 const admin=p.role==='admin';let warning='';
 async function notify(v:any){
  if(!v.recipient_email||v.email_status==='sent')return;
  let status='failed';
  try{const r=await fetch('https://www.appita318.it/api/voucher-email',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({voucherId:v.id}),signal:AbortSignal.timeout(40000)});if(r.status===409){warning='Invio email già in corso. Ricarica tra poco.';return;}status=r.ok?'sent':r.status===503?'not_configured':'failed';}catch{}
  let update=db.from('odr_course_vouchers').update({email_status:status,...(status==='sent'?{email_sent_at:new Date().toISOString()}: {})}).eq('id',v.id);if(status!=='sent')update=update.neq('email_status','sent');const {error}=await update;if(error)throw error;
  if(status!=='sent')warning='Voucher salvato. Email non inviata: usa WhatsApp o riprova dopo la configurazione del mittente.';
  await db.from('odr_course_audit').insert({actor_id:p.id,action:'voucher-email',details:{voucherId:v.id,status}});
 }
 try{
  if(req.method==='POST'){
   const b=await req.json();
   if(['email-ticket','email-result'].includes(b.action)){
    const secret=req.headers.get('x-voucher-mail-secret')||'';
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const {data:config,error}=await db.from('odr_voucher_mail_config').select('secret_hash').eq('id',true).single();
    if(error||!secret||hash!==config?.secret_hash)return json({error:'Operazione riservata al servizio email'},403);
   }
   if(b.action==='sync'){
    const r=await fetch('https://www.appita318.it/api/orders',{headers:{Authorization:auth},signal:AbortSignal.timeout(50000)});if(!r.ok)throw Error('Ordini non disponibili');
    const {orders}=await r.json();
    const [{data:courses,error:ce},{data:mappings,error:me},{data:owners,error:oe}]=await Promise.all([db.from('odr_courses').select('*'),db.from('odr_course_products').select('*'),db.from('profiles').select('id,email,role').eq('approval_status','approved').in('role',['agent','distributor','admin'])]);if(ce||me||oe)throw ce||me||oe;
    const emails=new Map();for(let page=1;page<=100;page++){const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});if(error)throw error;for(const u of data.users)emails.set(u.id,u.email?.toLowerCase());if(data.users.length<1000)break;}
    const canonicalOwners=(owners||[]).map(o=>({...o,email:emails.get(o.id)||''}));
    const plan=plans((orders||[]).filter((o:any)=>!b.orderId||o.id===b.orderId||o.id==='WC-'+b.orderId),mappings||[],courses||[],canonicalOwners,p.id,admin);
    if(plan.unmatched.length)warning=`${plan.unmatched.length} ordini richiedono un controllo del referente o del recapito del centro.`;
    for(const x of plan.result){
     // One code per physical promotional package. The included courses are snapshotted.
     if(x.eligible&&x.quantity){const rows=Array.from({length:x.quantity},(_,i)=>({owner_id:x.owner.id,source_order:x.order.id,order_number:String(x.order.number||x.order.id),product_id:x.productId,slot:i+1,package_name:x.packageName,course_titles:x.titles,material_ids:x.materialIds,customer_name:x.order.customerCompany||x.order.customer||'',customer_email:x.order.customerEmail||'',...(x.recipient?{...x.recipient,assigned_by:x.owner.id,assigned_at:new Date().toISOString(),email_status:x.recipient.recipient_email?'pending':'not_required'}:{})}));
      const {error}=await db.from('odr_course_vouchers').upsert(rows,{onConflict:'source_order,product_id,slot',ignoreDuplicates:true});if(error)throw error;
     }
     const {error:up}=await db.from('odr_course_vouchers').update({active:x.eligible}).eq('source_order',x.order.id).eq('product_id',x.productId).lte('slot',x.quantity);if(up)throw up;
     const {error:down}=await db.from('odr_course_vouchers').update({active:false}).eq('source_order',x.order.id).eq('product_id',x.productId).gt('slot',x.quantity);if(down)throw down;
    }
    let pending=db.from('odr_course_vouchers').select('*').eq('active',true).eq('email_status','pending').limit(20);if(!admin)pending=pending.eq('owner_id',p.id);
    const {data:queued}=await pending;for(const v of queued||[])await notify(v);
    await db.from('odr_course_audit').insert({actor_id:p.id,action:'voucher-sync',details:{orders:plan.result.length,unmatched:plan.unmatched}});
   }else if(['assign','send-email','email-ticket','email-result'].includes(b.action)){
    const {data:v}=await db.from('odr_course_vouchers').select('*').eq('id',b.voucherId).maybeSingle();
    if(!v||(!admin&&v.owner_id!==p.id))return json({error:'Voucher non disponibile'},403);
    if(!v.active)return json({error:'Voucher non attivo'},409);
    if(b.action==='email-ticket'){
     if(v.email_status==='sent')return json({alreadySent:true});
     if(!v.assigned_at||!v.recipient_email)return json({error:'Email destinatario mancante'},400);
     const ticket=crypto.randomUUID(),cutoff=new Date(Date.now()-120000).toISOString();
     const {data:reserved,error}=await db.from('odr_course_vouchers').update({email_attempt_id:ticket,email_attempt_at:new Date().toISOString()}).eq('id',v.id).neq('email_status','sent').or(`email_attempt_at.is.null,email_attempt_at.lt.${cutoff}`).select('*');if(error)throw error;
     if(!reserved?.length)return json({error:'Invio già in corso o appena tentato. Riprova tra due minuti.'},409);
     return json({ticket,voucher:reserved[0]});
    }
    if(b.action==='email-result'){
     const {data:updated,error}=await db.from('odr_course_vouchers').update({email_status:b.sent===true?'sent':'failed',...(b.sent===true?{email_sent_at:new Date().toISOString()}: {})}).eq('id',v.id).eq('email_attempt_id',String(b.ticket||'')).select('id');if(error)throw error;if(!updated?.length)return json({error:'Tentativo email non valido'},409);
     return json({recorded:true});
    }
    if(b.action==='assign'){
     if(v.assigned_at||v.activated_by)return json({error:'Voucher già assegnato'},409);
     let recipient;try{recipient={recipient_name:String(b.name||'').trim().slice(0,200),...contact(b.email,b.phone)};}catch(e){return json({error:String((e as Error).message)},400);}
     if(!recipient.recipient_name)return json({error:'Indica il nome del centro'},400);
     const {data:changed,error}=await db.from('odr_course_vouchers').update({...recipient,assigned_at:new Date().toISOString(),assigned_by:p.id,email_status:recipient.recipient_email?'pending':'not_required'}).eq('id',v.id).eq('active',true).is('assigned_at',null).is('activated_by',null).select('*');if(error)throw error;if(!changed?.length)return json({error:'Voucher già assegnato'},409);
     await db.from('odr_course_audit').insert({actor_id:p.id,action:'voucher-assigned',details:{voucherId:v.id}});await notify(changed[0]);
    }else{if(!v.assigned_at||!v.recipient_email)return json({error:'Il voucher non ha un indirizzo email assegnato'},400);await notify(v);}
   }else return json({error:'Operazione non valida'},400);
  }
  let q=db.from('odr_course_vouchers').select('*').order('created_at',{ascending:false}).limit(5000);if(!admin)q=q.eq('owner_id',p.id);
  const {data:vouchers,error}=await q;if(error)throw error;
  const ids=[...new Set((vouchers||[]).map(v=>v.owner_id))];
  const {data:owners}=ids.length?await db.from('profiles').select('id,full_name,email,role').in('id',ids):{data:[]};
  let history:any[]=[];if(admin){const {data}=await db.from('odr_course_audit').select('id,actor_id,action,details,created_at').like('action','voucher-%').order('created_at',{ascending:false}).limit(500);history=data||[];}
  return json({vouchers:vouchers||[],owners:owners||[],history,canManage:admin,warning});
 }catch(e){console.error('voucher-management',String(e));return json({error:'Gestione voucher non disponibile. Riprova tra poco.'},503);}
});
