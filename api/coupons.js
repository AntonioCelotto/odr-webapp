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

function couponPayload(body = {}) {
  const discountTypes = ['percent', 'fixed_cart', 'fixed_product'];
  const discountType = String(body.discountType || '');
  const code = String(body.code || '').trim().toLowerCase();
  const amount = Number(body.amount);
  if (!code || !discountTypes.includes(discountType) || !Number.isFinite(amount) || amount < 0) {
    throw new Error('Dati coupon non validi');
  }
  if (discountType === 'percent' && amount > 100) {
    throw new Error('La percentuale non può superare 100');
  }
  const optionalAmount = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Importo non valido');
    return parsed.toFixed(2);
  };
  const optionalLimit = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Limite non valido');
    return parsed;
  };
  return {
    code,
    description: String(body.description || '').trim().slice(0, 500),
    discount_type: discountType,
    amount: amount.toFixed(2),
    date_expires: body.expiresAt ? String(body.expiresAt).slice(0, 10) : null,
    usage_limit: optionalLimit(body.usageLimit),
    usage_limit_per_user: optionalLimit(body.usageLimitPerUser),
    minimum_amount: optionalAmount(body.minimumAmount),
    maximum_amount: optionalAmount(body.maximumAmount),
    individual_use: Boolean(body.individualUse),
    free_shipping: Boolean(body.freeShipping),
    exclude_sale_items: Boolean(body.excludeSaleItems),
  };
}

function serializeCoupon(coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    amount: coupon.amount,
    discountType: coupon.discount_type,
    description: String(coupon.description || '').replace(/<[^>]*>/g, '').trim(),
    usageCount: coupon.usage_count,
    usageLimit: coupon.usage_limit,
    usageLimitPerUser: coupon.usage_limit_per_user,
    expiresAt: coupon.date_expires,
    minimumAmount: coupon.minimum_amount,
    maximumAmount: coupon.maximum_amount,
    individualUse: coupon.individual_use,
    freeShipping: coupon.free_shipping,
    excludeSaleItems: coupon.exclude_sale_items,
  };
}

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    return json(response, 405, { error: 'Metodo non consentito' });
  }
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (!token || !await isAdmin(token)) return json(response, 403, { error: 'Accesso riservato' });
    const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    const couponId = Number(request.body?.id);
    if (request.method === 'PATCH' && (!Number.isInteger(couponId) || couponId < 1)) {
      return json(response, 400, { error: 'Coupon non valido' });
    }
    const path = request.method === 'PATCH'
      ? `/wp-json/wc/v3/coupons/${couponId}`
      : '/wp-json/wc/v3/coupons';
    const url = new URL(path, storeUrl);
    if (request.method === 'GET') url.searchParams.set('per_page', '100');
    const options = { headers: { Authorization: authorization } };
    if (request.method !== 'GET') {
      options.method = request.method === 'PATCH' ? 'PUT' : 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(couponPayload(request.body));
    }
    const wooResponse = await fetch(url, options);
    const wooPayload = await wooResponse.json().catch(() => ({}));
    if (!wooResponse.ok) throw new Error(`WooCommerce ${wooResponse.status}`);
    if (request.method === 'GET') return json(response, 200, { coupons: wooPayload.map(serializeCoupon) });
    return json(response, request.method === 'POST' ? 201 : 200, { coupon: serializeCoupon(wooPayload) });
  } catch (error) {
    console.error('coupons_error', error instanceof Error ? error.message : error);
    const invalidMessages = ['Dati coupon', 'Importo', 'Limite', 'La percentuale'];
    const invalid = error instanceof Error && invalidMessages.some((message) => error.message.startsWith(message));
    return json(response, invalid ? 400 : 502, {
      error: invalid ? error.message : 'Operazione coupon WooCommerce non riuscita',
    });
  }
}
