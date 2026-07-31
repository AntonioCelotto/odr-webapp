import { Buffer } from 'node:buffer';

function json(response, status, body) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(JSON.stringify(body));
}

async function getAuthenticatedProfile(token) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error('Supabase non configurato');
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${base}/auth/v1/user`, { headers });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const profileResponse = await fetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=approval_status,full_name,phone,wordpress_user_id`,
    { headers },
  );
  const [profile] = profileResponse.ok ? await profileResponse.json() : [];
  if (!profile || profile.approval_status !== 'approved') return null;
  return { ...profile, email: user.email };
}

function serializeAddress(profile, customer = {}) {
  const shipping = customer.shipping || {};
  const billing = customer.billing || {};
  const source = shipping.address_1 ? shipping : billing;
  const names = String(profile.full_name || '').trim().split(/\s+/);
  return {
    firstName: source.first_name || billing.first_name || names[0] || '',
    lastName: source.last_name || billing.last_name || names.slice(1).join(' '),
    company: source.company || billing.company || '',
    address1: source.address_1 || billing.address_1 || '',
    address2: source.address_2 || billing.address_2 || '',
    postcode: source.postcode || billing.postcode || '',
    city: source.city || billing.city || '',
    state: source.state || billing.state || '',
    country: source.country || billing.country || 'IT',
    phone: billing.phone || profile.phone || '',
    email: billing.email || profile.email || '',
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(response, 401, { error: 'Accesso richiesto' });

  try {
    const profile = await getAuthenticatedProfile(token);
    if (!profile) return json(response, 403, { error: 'Profilo non autorizzato' });
    if (!profile.wordpress_user_id) {
      return json(response, 200, { address: serializeAddress(profile) });
    }

    const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    if (!storeUrl || !key || !secret) throw new Error('WooCommerce non configurato');
    const endpoint = new URL(`/wp-json/wc/v3/customers/${Number(profile.wordpress_user_id)}`, storeUrl);
    const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    const wooResponse = await fetch(endpoint, { headers: { Authorization: authorization } });
    if (!wooResponse.ok) return json(response, 200, { address: serializeAddress(profile) });
    const customer = await wooResponse.json();
    if (String(customer.email || '').toLowerCase() !== String(profile.email || '').toLowerCase()) {
      return json(response, 200, { address: serializeAddress(profile) });
    }
    return json(response, 200, { address: serializeAddress(profile, customer) });
  } catch (error) {
    console.error('customer_address_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Indirizzo WooCommerce temporaneamente non disponibile' });
  }
}
