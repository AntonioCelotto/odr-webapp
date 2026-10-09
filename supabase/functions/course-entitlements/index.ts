import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
Deno.serve(async req=>{
 const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method!=='GET')return json({error:'Metodo non consentito'},405);
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return json({error:'Accesso richiesto'},401);
 const academy=createClient('https://hmezncgfhjyqifvyhect.supabase.co',"sb_publishable_4RXJz_kKt1t9IrjsBMKP4w_GJJzr7_h",{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await academy.auth.getUser(token);
 if(error||!user?.email)return json({error:'Sessione non valida'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:rows,error:e}=await db.from('odr_course_accesses').select('source_order,product_id,slot,course_id,odr_courses!inner(material_ids,active)').eq('recipient_email',user.email.trim().toLowerCase()).eq('active',true);
 if(e)return json({error:'Accessi non disponibili'},500);
 const {data:mappings,error:me}=await db.from('odr_course_products').select('*');if(me)return json({error:'Accessi non disponibili'},500);
 const assignments=(rows||[]).filter((r:any)=>r.odr_courses.active).map((r:any)=>({...r,material_ids:r.odr_courses.material_ids,accesses_per_unit:mappings?.find(m=>m.product_id===r.product_id&&m.course_id===r.course_id)?.accesses_per_unit||0}));
 return json({assignments:assignments.filter(r=>r.source_order.startsWith('manual:')||r.accesses_per_unit>0)});
});
