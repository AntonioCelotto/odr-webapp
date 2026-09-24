// Manual address lookup only. Provider can be changed through PHOTON_API_URL.
const cache = new Map();
let nextRequest = 0;
function reply(res, status, body) {
  res.status(status); res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(JSON.stringify(body));
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, {error:'Metodo non consentito'});
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(res, 403, {error:'Account non abilitato'});
  try {
    const base = process.env.SUPABASE_URL;
    const headers = {apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`};
    const auth = await fetch(`${base}/auth/v1/user`, {headers,signal:AbortSignal.timeout(8000)});
    if (!auth.ok) return reply(res, 403, {error:'Sessione scaduta. Accedi nuovamente.'});
    const user = await auth.json();
    const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,approval_status`, {headers,signal:AbortSignal.timeout(8000)});
    const [profile] = profileResponse.ok ? await profileResponse.json() : [];
    if (!['admin','agent','distributor'].includes(profile?.role) || profile.approval_status !== 'approved') return reply(res, 403, {error:'Account non abilitato'});
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const fields = ['address','postcode','city','country'].map(k=>String(body[k]||'').trim());
    if (!fields[0] || !fields[2] || !fields[3] || fields.some(s=>s.length>200)) return reply(res,400,{error:'Compila indirizzo, città e Paese (massimo 200 caratteri per campo).'});
    const query=fields.filter(Boolean).join(', '), key=query.toLowerCase();
    const cached=cache.get(key);
    if(cached && cached.expires>Date.now()) return reply(res,200,{results:cached.results});
    if(Date.now()<nextRequest) return reply(res,429,{error:'Attendi qualche secondo prima di cercare di nuovo.'});
    nextRequest=Date.now()+2000;
    const url=new URL(process.env.PHOTON_API_URL || 'https://photon.komoot.io/api/');
    url.searchParams.set('q',query);url.searchParams.set('limit','5');
    const response=await fetch(url,{headers:{'User-Agent':'ODRStoreLocator/1.0 (+https://www.appita318.it/store-locator)'},signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('provider unavailable');
    const data=await response.json();
    const results=(data.features||[]).filter(f=>f.geometry?.type==='Point').map(f=>{
      const p=f.properties||{},[longitude,latitude]=f.geometry.coordinates;
      return {latitude,longitude,label:[p.name,[p.street,p.housenumber].filter(Boolean).join(' '),p.postcode,p.city||p.town||p.village,p.state,p.country].filter(Boolean).join(', ')};
    }).filter(r=>Number.isFinite(r.latitude)&&Math.abs(r.latitude)<=90&&Number.isFinite(r.longitude)&&Math.abs(r.longitude)<=180&&r.label).slice(0,5);
    if(cache.size>=200)cache.delete(cache.keys().next().value);
    cache.set(key,{expires:Date.now()+86400000,results});
    return reply(res,200,{results});
  } catch {
    return reply(res,502,{error:'Ricerca posizione non disponibile. Riprova tra poco oppure indica il punto sulla mappa.'});
  }
}
