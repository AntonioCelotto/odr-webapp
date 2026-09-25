import { listManagedCustomers } from './agent-customers.js';

const roles = ['agent', 'distributor', 'center'];
function reply(res, status, data) {
  res.status(status); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(data));
}
export function validateItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('Carrello non valido');
  const ids = new Set();
  return items.map(({ productId, quantity }) => {
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || ids.has(productId)) throw new Error('Quantità o prodotto non valido');
    ids.add(productId); return { product_id: productId, quantity };
  });
}
export function address(value, email) {
  const fields = { firstName:'first_name', lastName:'last_name', company:'company', address1:'address_1', address2:'address_2', postcode:'postcode', city:'city', state:'state', country:'country', phone:'phone' };
  const result = Object.fromEntries(Object.entries(fields).map(([k,v]) => [v, String(value?.[k] || '').trim().slice(0,160)]));
  result.email = email; result.country = result.country.toUpperCase(); result.state = result.state.toUpperCase();
  if (['first_name','last_name','address_1','postcode','city','state','phone'].some(k=>!result[k]) || result.country !== 'IT' || !/^\d{5}$/.test(result.postcode) || !/^[A-Z]{2}$/.test(result.state)) throw new Error('Completa nome, indirizzo, CAP, provincia e telefono');
  return result;
}
export default async function handler(req,res) {
  if (req.method !== 'POST') return reply(res,405,{error:'Metodo non consentito'});
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return reply(res,401,{error:'Accesso richiesto'});
  try {
    const headers = { apikey:process.env.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${token}` };
    const auth = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{headers});
    if (!auth.ok) return reply(res,401,{error:'Sessione scaduta'});
    const user = await auth.json();
    const profiles = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,approval_status,network_entity_id,full_name,wordpress_user_id`,{headers});
    const [profile] = profiles.ok ? await profiles.json() : [];
    if (!roles.includes(profile?.role) || profile.approval_status !== 'approved') return reply(res,403,{error:'Profilo non autorizzato'});
    const action = req.body?.action;
    if (!['quote','confirm'].includes(action)) return reply(res,400,{error:'Operazione non valida'});
    let payload = { action, actor_id:profile.id };
    if (action === 'confirm') {
      if (!/^[a-f0-9]{64}$/.test(req.body?.quoteToken || '')) return reply(res,400,{error:'Riepilogo non valido'});
      payload.quote_token = req.body.quoteToken;
    } else {
      const customerId = String(req.body?.customerId || '');
      if (profile.role === 'agent' && !customerId) return reply(res,400,{error:'Seleziona il cliente per cui ordinare'});
      let customer;
      if (customerId) {
        if (!['agent','distributor'].includes(profile.role)) return reply(res,403,{error:'Cliente non autorizzato'});
        customer = (await listManagedCustomers({...profile,email:user.email,headers})).find(c=>c.id===customerId);
        if (!customer) return reply(res,403,{error:'Cliente non associato al tuo profilo'});
      }
      const email = customer?.email || user.email;
      const billing = address(customer?.address || req.body.address,email);
      const shipping = address(req.body.address,email);
      payload = {...payload, role:profile.role, actor_name:profile.full_name || '', entity_id:profile.network_entity_id || '', actor_email:user.email,
        customer_reference:customerId, customer_email:email, billing, shipping,
        payment_terms:customer?.paymentTerms || [],
        items:validateItems(req.body.items), coupon:String(req.body.coupon || '').trim().slice(0,100),
        shipping_methods:Array.isArray(req.body.shippingMethods) ? req.body.shippingMethods.map(String).slice(0,10) : [],
      };
      if (!payload.coupon) {
        const active = await fetch(`${process.env.SUPABASE_URL}/functions/v1/promo-codes?view=active`,{headers});
        if (!active.ok) throw new Error('Verifica codice attivo non disponibile');
        payload.coupon = String((await active.json()).activeCode?.woo_coupon || '');
      }
    }
    const endpoint = new URL('/wp-json/odr/v1/bank-checkout',process.env.WOOCOMMERCE_STORE_URL);
    const result = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,consumer_key:process.env.WOOCOMMERCE_CONSUMER_KEY,consumer_secret:process.env.WOOCOMMERCE_CONSUMER_SECRET}),signal:AbortSignal.timeout(55000)});
    const data = await result.json().catch(()=>({}));
    if (!result.ok) return reply(res,result.status >= 500 ? 502 : result.status,{error:data.message || 'Checkout non disponibile',code:data.code});
    return reply(res,200,data);
  } catch(error) {
    const expected = /Carrello|Quantità|Completa|Verifica codice/.test(error.message);
    return reply(res,expected ? 400 : 502,{error:expected ? error.message : 'Conferma non disponibile. Riprova: la stessa richiesta non crea un secondo ordine.'});
  }
}
