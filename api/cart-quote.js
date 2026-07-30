import { Buffer } from 'node:buffer';

const ROLE_CATEGORIES = {
  patient: ['persone-fisiche'],
  center: ['prodotti', 'prodotti-2', 'pacchetti-promozionali'],
  agent: ['prodotti', 'prodotti-2', 'pacchetti-promozionali', 'merchandising'],
  distributor: ['confezione_distributore', 'pacchetti-promozionali', 'merchandising'],
};

function json(response, status, body) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(JSON.stringify(body));
}

function safeItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    productId: Number(item?.productId),
    quantity: Math.max(1, Math.min(99, Number(item?.quantity) || 1)),
  })).filter((item) => Number.isInteger(item.productId) && item.productId > 0);
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
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,approval_status`,
    { headers },
  );
  const [profile] = profileResponse.ok ? await profileResponse.json() : [];
  if (!profile || profile.approval_status !== 'approved') return null;
  return { ...profile, email: user.email };
}

function wooClient() {
  const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!storeUrl || !key || !secret) throw new Error('WooCommerce non configurato');
  return {
    storeUrl,
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
  };
}

async function getWooProducts(client, items) {
  return Promise.all(items.map(async (item) => {
    const endpoint = new URL(`/wp-json/wc/v3/products/${item.productId}`, client.storeUrl);
    const result = await fetch(endpoint, { headers: client.headers });
    if (!result.ok) throw new Error('Uno dei prodotti non è più disponibile');
    return { item, product: await result.json() };
  }));
}

async function getWooCoupon(client, code) {
  if (!code) return null;
  const endpoint = new URL('/wp-json/wc/v3/coupons', client.storeUrl);
  endpoint.searchParams.set('code', code);
  endpoint.searchParams.set('per_page', '1');
  const result = await fetch(endpoint, { headers: client.headers });
  if (!result.ok) throw new Error('Verifica coupon non disponibile');
  const [coupon] = await result.json();
  if (!coupon) throw new Error('Codice promozionale non valido');
  return coupon;
}

function productAllowed(product, role) {
  const allowed = role === 'admin' ? null : ROLE_CATEGORIES[role] || [];
  return !allowed || product.categories?.some((category) => allowed.includes(category.slug));
}

function validateCoupon(coupon, subtotal, email) {
  if (coupon.date_expires && Date.parse(coupon.date_expires) < Date.now()) {
    throw new Error('Codice promozionale scaduto');
  }
  if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
    throw new Error('Limite utilizzi del codice raggiunto');
  }
  if (Number(coupon.minimum_amount || 0) > subtotal) {
    throw new Error(`Il codice richiede una spesa minima di € ${Number(coupon.minimum_amount).toFixed(2)}`);
  }
  if (Number(coupon.maximum_amount || 0) > 0 && subtotal > Number(coupon.maximum_amount)) {
    throw new Error(`Il codice è valido fino a € ${Number(coupon.maximum_amount).toFixed(2)}`);
  }
  const restrictions = (coupon.email_restrictions || []).map((value) => String(value).toLowerCase());
  if (restrictions.length && !restrictions.includes(String(email || '').toLowerCase())) {
    throw new Error('Codice promozionale non disponibile per questo account');
  }
}

function eligibleForCoupon(product, coupon) {
  const productIds = coupon.product_ids || [];
  const excludedProductIds = coupon.excluded_product_ids || [];
  const categoryIds = (product.categories || []).map((category) => category.id);
  if (productIds.length && !productIds.includes(product.id)) return false;
  if (excludedProductIds.includes(product.id)) return false;
  if ((coupon.product_categories || []).length
    && !categoryIds.some((id) => coupon.product_categories.includes(id))) return false;
  if (categoryIds.some((id) => (coupon.excluded_product_categories || []).includes(id))) return false;
  if (coupon.exclude_sale_items && product.on_sale) return false;
  return true;
}

function calculateDiscount(lines, coupon, subtotal) {
  if (!coupon) return 0;
  const eligible = lines.filter(({ product }) => eligibleForCoupon(product, coupon));
  const eligibleTotal = eligible.reduce((sum, { lineTotal }) => sum + lineTotal, 0);
  const amount = Number(coupon.amount || 0);
  if (coupon.discount_type === 'percent') return Math.min(subtotal, eligibleTotal * amount / 100);
  if (coupon.discount_type === 'fixed_product') {
    const quantity = eligible.reduce((sum, { item }) => sum + item.quantity, 0);
    return Math.min(subtotal, eligibleTotal, quantity * amount);
  }
  if (coupon.discount_type === 'fixed_cart') return Math.min(subtotal, eligibleTotal, amount);
  return 0;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(response, 401, { error: 'Accesso richiesto' });

  try {
    const profile = await getAuthenticatedProfile(token);
    if (!profile) return json(response, 403, { error: 'Profilo non autorizzato' });
    const items = safeItems(request.body?.items);
    if (!items.length) return json(response, 400, { error: 'Il carrello è vuoto' });

    const client = wooClient();
    const products = await getWooProducts(client, items);
    if (products.some(({ product }) => !productAllowed(product, profile.role))) {
      return json(response, 403, { error: 'Il carrello contiene un prodotto non disponibile per il profilo' });
    }
    if (products.some(({ product }) => !['instock', 'onbackorder'].includes(product.stock_status))) {
      return json(response, 409, { error: 'Il carrello contiene un prodotto esaurito' });
    }

    const lines = products.map(({ item, product }) => {
      const unitPrice = Number(product.price || 0);
      return { item, product, unitPrice, lineTotal: unitPrice * item.quantity };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const requestedCode = String(request.body?.coupon || '').trim().toLowerCase().slice(0, 100);
    const coupon = await getWooCoupon(client, requestedCode);
    if (coupon) validateCoupon(coupon, subtotal, profile.email);
    const discount = calculateDiscount(lines, coupon, subtotal);

    return json(response, 200, {
      subtotal: Number(subtotal.toFixed(2)),
      discount: Number(discount.toFixed(2)),
      total: Number(Math.max(0, subtotal - discount).toFixed(2)),
      coupon: coupon ? {
        code: coupon.code,
        description: String(coupon.description || '').replace(/<[^>]*>/g, '').trim(),
        freeShipping: Boolean(coupon.free_shipping),
      } : null,
      note: 'IVA e spedizione vengono calcolate definitivamente da WooCommerce prima del pagamento.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Riepilogo non disponibile';
    const expected = /codice|coupon|spesa minima|valido fino|account|prodotto|carrello/i.test(message);
    console.error('cart_quote_error', message);
    return json(response, expected ? 400 : 502, {
      error: expected ? message : 'Riepilogo del carrello temporaneamente non disponibile',
    });
  }
}
