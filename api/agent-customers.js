import { Buffer } from 'node:buffer';

function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(body));
}

const clean = (value, max = 250) => String(value || '').trim().slice(0, max);

async function authenticate(req) {
  const token = clean(req.headers.authorization).replace(/^Bearer\s+/i, '');
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const auth = await fetch(`${base}/auth/v1/user`, { headers });
  if (!auth.ok) return null;
  const user = await auth.json();
  const result = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=id,role,approval_status,network_entity_id`, { headers });
  const [profile] = result.ok ? await result.json() : [];
  return profile?.approval_status === 'approved' && ['agent', 'admin'].includes(profile.role)
    ? { ...profile, headers }
    : null;
}

function wooHeaders() {
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('WooCommerce non configurato');
  return { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` };
}

async function agentEntity(profile) {
  if (profile.role === 'admin') return null;
  if (!profile.network_entity_id) throw new Error('Agente non collegato alla rete commerciale');
  return profile.network_entity_id;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Metodo non consentito' });
  try {
    const profile = await authenticate(req);
    if (!profile) return json(res, 403, { error: 'Funzione riservata agli agenti' });
    const parentId = await agentEntity(profile);
    const base = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      const url = new URL('/rest/v1/network_entities', base);
      url.searchParams.set('type', 'eq.center');
      url.searchParams.set('active', 'eq.true');
      if (parentId) url.searchParams.set('parent_id', `eq.${parentId}`);
      url.searchParams.set('select', 'id,name,email,phone,area,external_code,created_at');
      url.searchParams.set('order', 'name.asc');
      const result = await fetch(url, { headers: adminHeaders });
      if (!result.ok) throw new Error('Elenco clienti non disponibile');
      return json(res, 200, { customers: await result.json() });
    }

    const body = req.body || {};
    const email = clean(body.email, 200).toLowerCase();
    const name = clean(body.name);
    if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Nome ed email validi sono obbligatori' });
    if (!parentId && profile.role === 'admin' && !clean(body.agentId, 80)) return json(res, 400, { error: 'Seleziona un agente' });
    const assignedAgent = parentId || clean(body.agentId, 80);

    const duplicateUrl = new URL('/rest/v1/network_entities', base);
    duplicateUrl.searchParams.set('type', 'eq.center');
    duplicateUrl.searchParams.set('email', `eq.${email}`);
    duplicateUrl.searchParams.set('select', 'id');
    const duplicate = await fetch(duplicateUrl, { headers: adminHeaders });
    if ((await duplicate.json()).length) return json(res, 409, { error: 'Questo cliente è già presente' });

    const parts = name.split(/\s+/);
    const customerUrl = new URL('/wp-json/wc/v3/customers', process.env.WOOCOMMERCE_STORE_URL);
    const customerResult = await fetch(customerUrl, {
      method: 'POST',
      headers: { ...wooHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        first_name: parts.shift() || name,
        last_name: parts.join(' '),
        billing: {
          first_name: name.split(/\s+/)[0] || name,
          last_name: name.split(/\s+/).slice(1).join(' '),
          company: clean(body.company), email, phone: clean(body.phone, 60),
          address_1: clean(body.address1, 160), postcode: clean(body.postcode, 20),
          city: clean(body.city, 100), state: clean(body.state, 10).toUpperCase(), country: 'IT',
        },
        shipping: {
          first_name: name.split(/\s+/)[0] || name,
          last_name: name.split(/\s+/).slice(1).join(' '),
          company: clean(body.company), address_1: clean(body.address1, 160),
          postcode: clean(body.postcode, 20), city: clean(body.city, 100),
          state: clean(body.state, 10).toUpperCase(), country: 'IT',
        },
      }),
    });
    const woo = await customerResult.json().catch(() => ({}));
    if (!customerResult.ok) throw new Error(woo.message || 'Creazione cliente WooCommerce non riuscita');

    const create = await fetch(new URL('/rest/v1/network_entities', base), {
      method: 'POST', headers: { ...adminHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        type: 'center', name, email, phone: clean(body.phone, 60) || null,
        area: clean(body.city, 100) || null, parent_id: assignedAgent,
        external_code: `WC-${woo.id}`, active: true, import_source: 'App agente',
      }),
    });
    const [entity] = create.ok ? await create.json() : [];
    if (!entity) throw new Error('Collegamento cliente alla rete non riuscito');
    return json(res, 201, { customer: entity });
  } catch (error) {
    console.error('agent_customers_error', error instanceof Error ? error.message : error);
    return json(res, 502, { error: error instanceof Error ? error.message : 'Operazione non riuscita' });
  }
}
