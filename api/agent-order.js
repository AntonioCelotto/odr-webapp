import { Buffer } from 'node:buffer';

function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(body));
}

async function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const auth = token && await fetch(`${base}/auth/v1/user`, { headers });
  if (!auth?.ok) return null;
  const user = await auth.json();
  const result = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=id,role,approval_status,network_entity_id,full_name`, { headers });
  const [profile] = result.ok ? await result.json() : [];
  return profile?.role === 'agent' && profile.approval_status === 'approved' ? profile : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Metodo non consentito' });
  try {
    const profile = await authenticate(req);
    if (!profile) return json(res, 403, { error: 'Agente non autorizzato' });
    const customerId = String(req.body?.customerId || '');
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50)
      .map((item) => ({ product_id: Number(item.productId), quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)) }))
      .filter((item) => Number.isInteger(item.product_id) && item.product_id > 0) : [];
    if (!customerId || !items.length) return json(res, 400, { error: 'Seleziona cliente e prodotti' });

    const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
    const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
    const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
    let wooCustomerId = Number(customerId.replace(/^wc-/, '')) || 0;
    let customer;
    if (customerId.startsWith('order-')) {
      const sourceId = Number(customerId.replace(/^order-/, ''));
      const sourceResponse = await fetch(new URL(`/wp-json/wc/v3/orders/${sourceId}`, process.env.WOOCOMMERCE_STORE_URL), { headers: { Authorization: authorization } });
      const source = await sourceResponse.json();
      if (!sourceResponse.ok) throw new Error('Dati del cliente non disponibili');
      customer = { billing: source.billing || {}, shipping: source.shipping || {} };
      wooCustomerId = Number(source.customer_id) || 0;
    } else {
      const customerUrl = new URL(`/wp-json/wc/v3/customers/${wooCustomerId}`, process.env.WOOCOMMERCE_STORE_URL);
      const customerResponse = await fetch(customerUrl, { headers: { Authorization: authorization } });
      customer = await customerResponse.json();
      if (!customerResponse.ok) throw new Error('Cliente WooCommerce non valido');
    }

    const orderUrl = new URL('/wp-json/wc/v3/orders', process.env.WOOCOMMERCE_STORE_URL);
    const orderResponse = await fetch(orderUrl, {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'pending', customer_id: wooCustomerId, billing: customer.billing,
        shipping: customer.shipping, line_items: items,
        coupon_lines: req.body?.coupon ? [{ code: String(req.body.coupon).trim().toLowerCase() }] : [],
        created_via: 'odr-agent-app',
        meta_data: [
          { key: '_odr_agent_profile_id', value: profile.id },
          { key: '_odr_agent_entity_id', value: profile.network_entity_id || '' },
          { key: '_odr_agent_name', value: profile.full_name || '' },
          { key: '_odr_customer_reference', value: customerId },
        ],
      }),
    });
    const order = await orderResponse.json().catch(() => ({}));
    if (!orderResponse.ok) throw new Error(order.message || 'Creazione ordine non riuscita');
    const paymentUrl = order.payment_url || `${process.env.WOOCOMMERCE_STORE_URL}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${encodeURIComponent(order.order_key)}`;
    return json(res, 201, { orderId: order.id, paymentUrl });
  } catch (error) {
    console.error('agent_order_error', error instanceof Error ? error.message : error);
    return json(res, 502, { error: error instanceof Error ? error.message : 'Ordine non riuscito' });
  }
}
