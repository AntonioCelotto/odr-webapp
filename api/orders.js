import { Buffer } from 'node:buffer';

function json(response, status, body) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(JSON.stringify(body));
}

async function getProfile(token) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const authResponse = await fetch(`${base}/auth/v1/user`, { headers });
  if (!authResponse.ok) return null;
  const user = await authResponse.json();
  const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=role,approval_status`, { headers });
  const [profile] = profileResponse.ok ? await profileResponse.json() : [];
  return profile?.approval_status === 'approved' ? { ...profile, email: user.email } : null;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const profile = token ? await getProfile(token) : null;
    if (!profile) return json(response, 403, { error: 'Accesso richiesto' });
    const url = new URL('/wp-json/wc/v3/orders', process.env.WOOCOMMERCE_STORE_URL);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('orderby', 'date');
    url.searchParams.set('order', 'desc');
    const authorization = `Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}`;
    const wooResponse = await fetch(url, { headers: { Authorization: authorization } });
    if (!wooResponse.ok) throw new Error(`WooCommerce ${wooResponse.status}`);
    const orders = (await wooResponse.json())
      .filter((order) => profile.role === 'admin' || order.billing?.email?.toLowerCase() === profile.email?.toLowerCase())
      .map((order) => ({
        id: `WC-${order.id}`,
        date: order.date_created?.slice(0, 10) || '',
        customer: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || order.billing?.email || 'Cliente',
        amount: Number(order.total) || 0,
        coupon: order.coupon_lines?.map((coupon) => coupon.code).join(', ') || '',
        agent: '',
        distributor: '',
        status: order.status,
      }));
    return json(response, 200, { orders });
  } catch (error) {
    console.error('orders_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Ordini WooCommerce non disponibili' });
  }
}
