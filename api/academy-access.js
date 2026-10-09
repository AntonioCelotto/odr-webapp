import { Buffer } from 'node:buffer';
export function eligibleOrder(order) { return ['processing','completed'].includes(order.status); }
export function orderSupports(order, productId, slot, units) {
 if (!eligibleOrder(order)) return false;
 const quantity=(order.line_items||[]).filter(l=>Number(l.product_id)===Number(productId)).reduce((sum,l)=>sum+Math.max(0,Number(l.quantity)||0),0);
 return slot>0 && slot<=quantity*units;
}
export default async function handler(req,res) {
 const json=(s,b)=>{res.status(s);res.setHeader('Cache-Control','private, no-store');res.json(b)};
 if(req.method!=='GET')return json(405,{error:'Metodo non consentito'});
 const auth=req.headers.authorization||'';
 if(!/^Bearer\s+\S+$/.test(auth))return json(401,{error:'Accesso richiesto'});
 try {
  // The ODR function validates the Academy token against Academy Auth and returns only this email's assignments.
  const r=await fetch(`${process.env.SUPABASE_URL}/functions/v1/course-entitlements`,{headers:{Authorization:auth,apikey:process.env.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(12000)});
  if(!r.ok)return json(r.status===401?401:502,{error:'Accessi non disponibili'});
  const {assignments}=await r.json();
  const authorization=`Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}`;
  const orders=new Map(); const ids=new Set();
  for(const a of assignments||[]) {
   if(a.source_order.startsWith('manual:')){for(const id of a.material_ids)ids.add(id);continue;}
   const orderId=Number(a.source_order.replace('WC-',''));
   if(!Number.isSafeInteger(orderId)||orderId<=0)continue;
   if(!orders.has(orderId)){
    const u=new URL(`/wp-json/wc/v3/orders/${orderId}`,process.env.WOOCOMMERCE_STORE_URL);
    const o=await fetch(u,{headers:{Authorization:authorization},signal:AbortSignal.timeout(12000)});
    if(o.status===404)orders.set(orderId,null);else if(!o.ok)throw Error('Ordine non disponibile');else orders.set(orderId,await o.json());
   }
   const order=orders.get(orderId);
   if(order && orderSupports(order,a.product_id,a.slot,a.accesses_per_unit))for(const id of a.material_ids)ids.add(id);
  }
  return json(200,{materialIds:[...ids]});
 }catch{return json(503,{error:'Verifica dei corsi non disponibile. Riprova tra poco.'})}
}
