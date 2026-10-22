import {Buffer} from 'node:buffer';
import {orderSupports} from './academy-access.js';
export default async function handler(req,res){
 const json=(s,v)=>{res.status(s);res.setHeader('Cache-Control','private, no-store');res.json(v);};
 if(!['GET','POST'].includes(req.method))return json(405,{error:'Metodo non consentito'});
 const auth=req.headers.authorization||'';if(!/^Bearer\s+\S+$/.test(auth))return json(401,{error:'Accedi ad Academy'});
 const access=req.method==='GET';
 try{
  const url=new URL('/functions/v1/voucher-redemption',process.env.SUPABASE_URL);
  if(access)url.searchParams.set('mode','access');else url.searchParams.set('mode','inspect');
  const r=await fetch(url,{method:access?'GET':'POST',headers:{Authorization:auth,apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},...(access?{}:{body:JSON.stringify({code:String(req.body?.code||'')})}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)return json(r.status,{error:'Voucher non disponibile'});
  const data=await r.json(),rows=access?data.assignments:[data.assignment];
  const authorization=`Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}`;
  const orders=new Map(),ids=new Set();let eligible=false;
  for(const a of rows||[]){
   if(!a)continue;const id=Number(String(a.source_order).replace(/^WC-/,''));if(!Number.isSafeInteger(id)||id<=0)continue;
   if(!orders.has(id)){const u=new URL(`/wp-json/wc/v3/orders/${id}`,process.env.WOOCOMMERCE_STORE_URL);const o=await fetch(u,{headers:{Authorization:authorization},signal:AbortSignal.timeout(12000)});if(o.status===404)orders.set(id,null);else if(!o.ok)throw Error('Ordine non disponibile');else orders.set(id,await o.json());}
   const o=orders.get(id);if(o&&orderSupports(o,a.product_id,a.slot,1)){eligible=true;for(const material of a.material_ids||[])ids.add(material);}
  }
  return json(200,access?{materialIds:[...ids]}:{eligible});
 }catch{return json(503,{error:'Verifica voucher non disponibile'});}
}
