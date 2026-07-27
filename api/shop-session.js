function json(response, status, body) {
  response.status(status);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(JSON.stringify(body));
}

async function getAuthenticatedProfile(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase non configurato');

  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
  };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,approval_status,full_name,wordpress_user_id`,
    { headers },
  );
  if (!profileResponse.ok) throw new Error('Profilo non disponibile');
  const [profile] = await profileResponse.json();
  if (!profile || profile.approval_status !== 'approved') return null;
  return { ...profile, email: user.email, headers };
}

function safeWooDestination(value, storeUrl) {
  const fallback = new URL('/shop/', storeUrl);
  try {
    const destination = new URL(value || fallback, storeUrl);
    if (destination.hostname !== new URL(storeUrl).hostname) return fallback.toString();
    if (!['https:', 'http:'].includes(destination.protocol)) return fallback.toString();
    return destination.toString();
  } catch {
    return fallback.toString();
  }
}

function safeCartItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    product_id: Number(item?.productId),
    quantity: Math.max(1, Math.min(99, Number(item?.quantity) || 1)),
  })).filter((item) => Number.isInteger(item.product_id) && item.product_id > 0);
}

async function getActiveCoupon(token) {
  const endpoint = new URL('/functions/v1/promo-codes', process.env.SUPABASE_URL);
  endpoint.searchParams.set('view', 'active');
  const result = await fetch(endpoint, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!result.ok) return '';
  const payload = await result.json();
  return String(payload.activeCode?.woo_coupon || '').trim().slice(0, 100);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Metodo non consentito' });

  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json(response, 401, { error: 'Accesso richiesto' });

  try {
    const profile = await getAuthenticatedProfile(token);
    if (!profile) return json(response, 403, { error: 'Profilo non autorizzato' });

    const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    if (!storeUrl || !key || !secret) throw new Error('WooCommerce non configurato');

    const sessionEndpoint = new URL('/wp-json/odr/v1/session', storeUrl);
    sessionEndpoint.searchParams.set('consumer_key', key);
    sessionEndpoint.searchParams.set('consumer_secret', secret);
    const activeCoupon = await getActiveCoupon(token);
    const wordpressResponse = await fetch(sessionEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: profile.email,
        name: profile.full_name || profile.email,
        role: profile.role,
        redirect: safeWooDestination(request.body?.redirect, storeUrl),
        items: safeCartItems(request.body?.items),
        coupon: activeCoupon,
      }),
    });
    const payload = await wordpressResponse.json().catch(() => ({}));
    if (!wordpressResponse.ok || !payload.url) {
      throw new Error(payload.message || `WordPress ${wordpressResponse.status}`);
    }

    if (!profile.wordpress_user_id && payload.wordpress_user_id) {
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`,
        {
          method: 'PATCH',
          headers: {
            ...profile.headers,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ wordpress_user_id: payload.wordpress_user_id }),
        },
      ).catch(() => {});
    }

    return json(response, 200, {
      url: payload.url,
      wordpressUserId: payload.wordpress_user_id,
    });
  } catch (error) {
    console.error('shop_session_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Accesso automatico allo shop non disponibile' });
  }
}
