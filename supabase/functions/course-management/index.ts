import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(v:unknown,n=200)=>String(v||'').trim().slice(0,n);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(!['GET','POST'].includes(req.method))return json({error:'Metodo non consentito'},405);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const auth=req.headers.get('Authorization')||'';const token=auth.replace(/^Bearer\s+/i,'');
 const {data:{user},error:ue}=await db.auth.getUser(token);if(ue||!user)return json({error:'Sessione non valida'},401);
 const {data:p}=await db.from('profiles').select('id,email,role,approval_status').eq('id',user.id).single();
 if(!p||p.approval_status!=='approved'||!['admin','agent','distributor'].includes(p.role))return json({error:'Profilo non autorizzato'},403);
 const admin=p.role==='admin';
 try{
  const {data:courses,error:ce}=await db.from('odr_courses').select('*').order('title');if(ce)throw ce;
  const {data:mappings,error:me}=await db.from('odr_course_products').select('*');if(me)throw me;
  if(req.method==='POST'){
   const b=await req.json();
   if(b.action==='save-course'){
    if(!admin)return json({error:'Operazione riservata agli amministratori'},403);
    const title=clean(b.title,180),ids=[...new Set((b.materialIds||[]).map((v:unknown)=>clean(v,36)))];
    if(!title||!ids.length||ids.some((id)=>!/^[0-9a-f-]{36}$/i.test(String(id))))return json({error:'Seleziona il titolo e almeno un video'},400);
    const catalog=await fetch('https://hmezncgfhjyqifvyhect.supabase.co/functions/v1/academy-course-catalog',{signal:AbortSignal.timeout(10000)});
    if(!catalog.ok)throw Error('Catalogo Academy non disponibile');const {materials}=await catalog.json();
    if(ids.some(id=>!materials.some((m:any)=>m.id===id)))return json({error:'Video non disponibile su Academy'},400);
    const payload={title,material_ids:ids,active:b.active!==false};
    const q=b.id?db.from('odr_courses').update(payload).eq('id',b.id):db.from('odr_courses').insert(payload);
    const {error}=await q;if(error)throw error;
   }else if(b.action==='map-product'){
    if(!admin)return json({error:'Operazione riservata agli amministratori'},403);
    const productId=Number(b.productId),units=Number(b.accessesPerUnit||1);
    if(!Number.isSafeInteger(productId)||productId<1||!Number.isInteger(units)||units<1||units>100||!courses?.some(c=>c.id===b.courseId))return json({error:'Promo o corso non valido'},400);
    const catalog=await fetch('https://appita318.it/api/catalog',{headers:{Authorization:auth},signal:AbortSignal.timeout(20000)});
    if(!catalog.ok)throw Error('Catalogo shop non disponibile');const data=await catalog.json();
    if(!(data.products||[]).some((p:any)=>Number(p.id)===productId))return json({error:'Prodotto non disponibile nello shop'},400);
    const {error}=await db.from('odr_course_products').upsert({product_id:productId,course_id:b.courseId,accesses_per_unit:units});if(error)throw error;
   }else if(b.action==='manual-grant'){
    if(!admin)return json({error:'Operazione riservata agli amministratori'},403);
    const quantity=Number(b.quantity),{data:owner}=await db.from('profiles').select('id,role,approval_status').eq('id',b.ownerId).maybeSingle();
    if(!owner||owner.approval_status!=='approved'||!['admin','agent','distributor'].includes(owner.role)||!Number.isInteger(quantity)||quantity<1||quantity>100||!courses?.some(c=>c.id===b.courseId))return json({error:'Accessi o destinatario non validi'},400);
    const source='manual:'+crypto.randomUUID();
    const {error}=await db.from('odr_course_accesses').insert(Array.from({length:quantity},(_,i)=>({owner_id:owner.id,course_id:b.courseId,source_order:source,slot:i+1})));if(error)throw error;
    const {error:audit}=await db.from('odr_course_audit').insert({actor_id:p.id,action:'manual-grant',details:{ownerId:owner.id,courseId:b.courseId,quantity,source,note:clean(b.note,300)}});if(audit)throw audit;
   }else if(b.action==='assign'||b.action==='revoke'){
    const {data:access}=await db.from('odr_course_accesses').select('*').eq('id',b.accessId).maybeSingle();
    if(!access||(!admin&&access.owner_id!==p.id))return json({error:'Accesso non disponibile'},403);
    if(b.action==='revoke'){
     if(!admin)return json({error:'Solo l’amministratore può correggere un’assegnazione'},403);
     const {error}=await db.from('odr_course_accesses').update({recipient_email:null,recipient_name:null,assigned_by:null,assigned_at:null}).eq('id',access.id);if(error)throw error;
    }else{
     const email=clean(b.email).toLowerCase(),name=clean(b.name);
     if(!/^\S+@\S+\.\S+$/.test(email)||!name)return json({error:'Nome del centro ed email validi sono obbligatori'},400);
     if(!access.active||access.recipient_email||!courses?.some(c=>c.id===access.course_id&&c.active))return json({error:'Accesso già assegnato o non attivo'},409);
     // Compare-and-set prevents two simultaneous requests consuming the same slot.
     const {data:updated,error}=await db.from('odr_course_accesses').update({recipient_email:email,recipient_name:name,assigned_by:p.id,assigned_at:new Date().toISOString()}).eq('id',access.id).eq('active',true).is('recipient_email',null).select('id');
     if(error?.code==='23505')return json({error:'Questo centro ha già un accesso al corso'},409);if(error)throw error;if(!updated?.length)return json({error:'Accesso già assegnato'},409);
    }
    const {error:audit}=await db.from('odr_course_audit').insert({actor_id:p.id,action:b.action,access_id:access.id,details:{email:clean(b.email).toLowerCase(),previousEmail:access.recipient_email}});if(audit)throw audit;
   }else if(b.action!=='sync')return json({error:'Operazione non valida'},400);
   if(['sync','assign'].includes(b.action)){
    // Assignment is validated again by Academy against the current WooCommerce order.
    if(b.action==='sync'){
     const r=await fetch('https://appita318.it/api/orders',{headers:{Authorization:auth},signal:AbortSignal.timeout(50000)});if(!r.ok)throw Error('Ordini non disponibili');const {orders}=await r.json();
     const {data:owners,error:oe}=await db.from('profiles').select('id,email,role').eq('approval_status','approved').in('role',['agent','distributor','admin']);if(oe)throw oe;
     const identityEmails=new Map<string,string>();
     for(let page=1;page<=100;page++){const {data:authUsers,error:authError}=await db.auth.admin.listUsers({page,perPage:1000});if(authError)throw authError;for(const u of authUsers.users)identityEmails.set(u.id,u.email?.trim().toLowerCase()||'');if(authUsers.users.length<1000)break;}
     for(const order of orders||[]){
      const matched=owners?.filter(o=>identityEmails.get(o.id)===String(order.customerEmail||'').trim().toLowerCase());
      if(matched?.length!==1)continue;const owner=matched[0];if(!admin&&owner.id!==p.id)continue;
      for(const mapping of mappings||[]){
       const q=(order.items||[]).filter((l:any)=>Number(l.productId)===mapping.product_id).reduce((sum:number,l:any)=>sum+Math.max(0,Number(l.quantity)||0),0);
       const count=Math.min(10000,Math.floor(q*mapping.accesses_per_unit));const eligible=['processing','completed'].includes(order.status);
       if(count){const rows=Array.from({length:count},(_,i)=>({owner_id:owner.id,course_id:mapping.course_id,source_order:order.id,product_id:mapping.product_id,slot:i+1,active:eligible}));
        const {error}=await db.from('odr_course_accesses').upsert(rows,{onConflict:'source_order,product_id,course_id,slot',ignoreDuplicates:true});if(error)throw error;}
       const base=db.from('odr_course_accesses').update({active:eligible}).eq('source_order',order.id).eq('product_id',mapping.product_id).eq('course_id',mapping.course_id).lte('slot',count);const {error:up}=await base;if(up)throw up;
       const {error:down}=await db.from('odr_course_accesses').update({active:false}).eq('source_order',order.id).eq('product_id',mapping.product_id).eq('course_id',mapping.course_id).gt('slot',count);if(down)throw down;
      }
     }
    }
   }
  }
  let q=db.from('odr_course_accesses').select('*').order('created_at',{ascending:false});if(!admin)q=q.eq('owner_id',p.id);
  const {data:accesses,error:ae}=await q;if(ae)throw ae;
  const {data:owners}=admin?await db.from('profiles').select('id,email,full_name,role').eq('approval_status','approved').in('role',['admin','agent','distributor']):{data:[]};
  const {data:freshCourses}=await db.from('odr_courses').select('*').order('title');const {data:freshMappings}=await db.from('odr_course_products').select('*');
  return json({courses:freshCourses||[],mappings:freshMappings||[],accesses:accesses||[],owners:owners||[],canManage:admin});
 }catch(e){console.error('course-management',String(e));return json({error:'Operazione non riuscita. Riprova tra poco.'},500)}
});
