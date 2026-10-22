import {createClient} from 'npm:@supabase/supabase-js@2.110.8';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async req=>{
 const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:cors});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(!['GET','POST'].includes(req.method))return json({error:'Metodo non consentito'},405);
 const auth=req.headers.get('Authorization')||'',token=auth.replace(/^Bearer\s+/i,'');
 const academy=createClient('https://hmezncgfhjyqifvyhect.supabase.co','sb_publishable_4RXJz_kKt1t9IrjsBMKP4w_GJJzr7_h',{auth:{persistSession:false}});
 const {data:{user},error}=await academy.auth.getUser(token);if(error||!user?.email)return json({error:'Accedi ad Academy'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  const url=new URL(req.url),mode=url.searchParams.get('mode');
  // This read is bound to the verified Academy user ID, never a supplied email.
  if(req.method==='GET'&&mode==='access'){
   const {data,error}=await db.from('odr_course_vouchers').select('id,source_order,product_id,slot,material_ids').eq('activated_by',user.id).eq('active',true);if(error)throw error;return json({assignments:data||[]});
  }
  const {data:allowed,error:rateError}=await db.rpc('odr_voucher_attempt',{target_user:user.id});if(rateError)throw rateError;if(!allowed)return json({error:'Troppi tentativi. Riprova tra 15 minuti.'},429);
  const b=req.method==='POST'?await req.json():{},code=String(b.code||url.searchParams.get('code')||'').trim().toUpperCase().replace(/\s/g,'');
  if(!/^ODR-[A-F0-9]{32}$/.test(code))return json({error:'Codice voucher non valido'},400);
  const {data:v,error:e}=await db.from('odr_course_vouchers').select('*').eq('code',code).maybeSingle();if(e)throw e;
  if(!v||!v.active||!v.assigned_at)return json({error:'Voucher non valido o non ancora assegnato'},400);
  if(v.activated_by)return json({error:'Voucher già attivato'},409);
  if(req.method==='GET'||mode==='inspect')return json({assignment:{id:v.id,source_order:v.source_order,product_id:v.product_id,slot:v.slot}});
  // Verify the authoritative WooCommerce status/quantity before the atomic claim.
  const check=await fetch('https://www.appita318.it/api/voucher-check',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(25000)});
  if(!check.ok)return json({error:'Verifica ordine non disponibile. Riprova.'},503);
  const {eligible}=await check.json();if(!eligible)return json({error:'Il voucher non è attivo per questo ordine'},409);
  const {data:claimed,error:claimError}=await db.rpc('odr_redeem_voucher',{voucher_id:v.id,target_user:user.id,target_email:user.email});if(claimError)throw claimError;
  if(!claimed)return json({error:'Voucher già attivato o non disponibile'},409);
  return json({activated:true,packageName:v.package_name,courseTitles:v.course_titles});
 }catch(e){console.error('voucher-redemption',String(e));return json({error:'Attivazione non disponibile. Riprova tra poco.'},503);}
});
