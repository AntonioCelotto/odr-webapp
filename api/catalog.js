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

function safeText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function bundleRows(product) {
  const raw = (product.meta_data || []).find((item) => item?.key === 'woosb_ids')?.value;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw);
  if (typeof raw !== 'string') return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return Object.values(parsed);
  } catch {
    // Older plugin versions used a compact id/key/quantity string.
  }

  return raw.split(',').map((entry) => {
    const [id, second, third] = entry.split('/');
    return { id: Number(id), qty: Number(third ?? second ?? 1) };
  });
}

function productAudience(product) {
  const value = `${product?.name || ''} ${product?.sku || ''}`.toLowerCase();
  if (value.includes('professional')) return 'Professional';
  if (value.includes('retail')) return 'Retail';
  return '';
}

async function getAuthenticatedProfile(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase non configurato');

  const authHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
  };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,approval_status`,
    { headers: authHeaders },
  );
  if (!profileResponse.ok) throw new Error('Profilo non disponibile');
  const [profile] = await profileResponse.json();
  if (!profile || profile.approval_status !== 'approved') return null;
  return profile;
}

async function getWooProducts() {
  const baseUrl = process.env.WOOCOMMERCE_STORE_URL;
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!baseUrl || !key || !secret) throw new Error('WooCommerce non configurato');

  const endpoint = new URL('/wp-json/wc/v3/products', baseUrl);
  endpoint.searchParams.set('status', 'publish');
  endpoint.searchParams.set('per_page', '100');
  endpoint.searchParams.set('orderby', 'menu_order');
  endpoint.searchParams.set('order', 'asc');
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;

  const requestOptions = { headers: { Authorization: authorization }, cache: 'no-store' };
  const firstResponse = await fetch(endpoint, requestOptions);
  if (!firstResponse.ok) throw new Error(`WooCommerce ${firstResponse.status}`);
  const firstPage = await firstResponse.json();
  const pages = Number(firstResponse.headers.get('x-wp-totalpages') || 1);
  if (pages < 2) return firstPage;

  const requests = [];
  for (let page = 2; page <= pages; page += 1) {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set('page', String(page));
    requests.push(fetch(pageUrl, requestOptions).then((res) => {
      if (!res.ok) throw new Error(`WooCommerce ${res.status}`);
      return res.json();
    }));
  }
  return firstPage.concat(...await Promise.all(requests));
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Metodo non consentito' });

  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json(response, 401, { error: 'Accesso richiesto' });

  try {
    const profile = await getAuthenticatedProfile(token);
    if (!profile) return json(response, 403, { error: 'Profilo non autorizzato' });

    const allowed = profile.role === 'admin' ? null : ROLE_CATEGORIES[profile.role] || [];
    const wooProducts = await getWooProducts();
    const productsById = new Map(wooProducts.map((product) => [Number(product.id), product]));
    const products = wooProducts
      .filter((product) => {
        if (!allowed) return true;
        return product.categories?.some((category) => allowed.includes(category.slug));
      })
      .map((product) => ({
        id: product.id,
        name: safeText(product.name),
        sku: safeText(product.sku),
        type: product.type,
        price: product.price,
        regularPrice: product.regular_price,
        salePrice: product.sale_price,
        onSale: product.on_sale,
        inStock: product.stock_status === 'instock' || product.stock_status === 'onbackorder',
        stockStatus: product.stock_status,
        image: product.images?.[0]?.src || '',
        imageUpdatedAt: product.images?.[0]?.date_modified_gmt
          || product.images?.[0]?.date_modified
          || product.date_modified_gmt
          || product.date_modified
          || '',
        categories: (product.categories || []).map(({ id, name, slug }) => ({ id, name, slug })),
        permalink: product.permalink,
        shortDescription: safeText(product.short_description),
        bundleItems: bundleRows(product).map((row) => {
          const bundledProduct = productsById.get(Number(row?.id));
          if (!bundledProduct) return null;
          return {
            id: Number(bundledProduct.id),
            quantity: Math.max(0, Number(row?.qty) || 0),
            name: safeText(bundledProduct.name),
            sku: safeText(bundledProduct.sku),
            audience: productAudience(bundledProduct),
            price: bundledProduct.price,
            image: bundledProduct.images?.[0]?.src || '',
            shortDescription: safeText(bundledProduct.short_description),
          };
        }).filter((item) => item && item.quantity > 0),
      }));

    return json(response, 200, {
      role: profile.role,
      allowedCategories: allowed,
      products,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('catalog_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Catalogo temporaneamente non disponibile' });
  }
}
