import { Buffer } from 'node:buffer';

function json(response, status, body) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(JSON.stringify(body));
}

async function isAdmin(token) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${base}/auth/v1/user`, { headers });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=role,approval_status`, { headers });
  const [profile] = profileResponse.ok ? await profileResponse.json() : [];
  return profile?.role === 'admin' && profile?.approval_status === 'approved';
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (!token || !await isAdmin(token)) return json(response, 403, { error: 'Accesso riservato' });
    const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    const url = new URL('/wp-json/wc/v3/coupons', storeUrl);
    url.searchParams.set('per_page', '100');
    const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    const wooResponse = await fetch(url, { headers: { Authorization: authorization } });
    if (!wooResponse.ok) throw new Error(`WooCommerce ${wooResponse.status}`);
    const coupons = (await wooResponse.json()).map((coupon) => ({
      id: coupon.id,
      code: coupon.code,
      amount: coupon.amount,
      discountType: coupon.discount_type,
      description: String(coupon.description || '').replace(/<[^>]*>/g, '').trim(),
      usageCount: coupon.usage_count,
      usageLimit: coupon.usage_limit,
      expiresAt: coupon.date_expires,
    }));
    return json(response, 200, { coupons });
  } catch (error) {
    console.error('coupons_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Coupon WooCommerce non disponibili' });
  }
}
