import { Buffer } from 'node:buffer';
import { loadAttributionIndex, assignmentKey, metaValue } from './_order-attribution.js';

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
  const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=id,email,full_name,role,approval_status,network_entity_id,wordpress_user_id`, { headers });
  const [profile] = profileResponse.ok ? await profileResponse.json() : [];
  return profile?.approval_status === 'approved' ? { ...profile, email: user.email, headers } : null;
}

export default async function handler(request, response) {
  if (!['GET', 'PATCH'].includes(request.method)) return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const profile = token ? await getProfile(token) : null;
    if (!profile) return json(response, 403, { error: 'Accesso richiesto' });
    const authorization = `Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}`;
    if (request.method === 'PATCH') {
      if (profile.role !== 'admin') return json(response, 403, {error:'Operazione riservata agli amministratori'});
      const { orderId, mode, entityId } = request.body || {};
      if (!Number.isSafeInteger(Number(orderId)) || Number(orderId) <= 0 || !['manual','automatic'].includes(mode)) return json(response,400,{error:'Associazione non valida'});
      if (mode === 'manual') {
        const networkResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/network-management`,{headers:profile.headers});
        if (!networkResponse.ok) throw new Error('Rete non disponibile');
        const network = await networkResponse.json();
        if (!(network.entities || []).some(entity => entity.id === entityId && entity.active && ['agent','distributor'].includes(entity.type))) return json(response,400,{error:'Seleziona un agente o distributore attivo'});
      }
      const url = new URL(`/wp-json/wc/v3/orders/${Number(orderId)}`,process.env.WOOCOMMERCE_STORE_URL);
      const before = await fetch(url,{headers:{Authorization:authorization},cache:'no-store'});
      if (!before.ok) return json(response,before.status===404?404:502,{error:'Ordine non disponibile'});
      const existing = await before.json();
      const savedMeta = (existing.meta_data || []).find(item => item.key === assignmentKey);
      const value = {mode, entityId:mode==='manual'?entityId:'', updatedBy:profile.id, updatedAt:new Date().toISOString()};
      const result = await fetch(url,{method:'PUT',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({meta_data:[{...(savedMeta?{id:savedMeta.id}:{}),key:assignmentKey,value}]})});
      if (!result.ok) throw new Error('Salvataggio associazione non riuscito');
      const saved = metaValue(await result.json(), assignmentKey);
      if (saved?.mode !== value.mode || saved?.entityId !== value.entityId) throw new Error('Associazione non confermata da WooCommerce');
      return json(response,200,{saved:true});
    }
    const attributionIndex = await loadAttributionIndex(authorization, profile);
    const wooOrders = [];
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL('/wp-json/wc/v3/orders', process.env.WOOCOMMERCE_STORE_URL);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      url.searchParams.set('orderby', 'date');
      url.searchParams.set('order', 'desc');
      const wooResponse = await fetch(url, { headers: { Authorization: authorization } });
      if (!wooResponse.ok) {
        if (wooResponse.status === 400 && page > 1) break;
        throw new Error(`WooCommerce ${wooResponse.status}`);
      }
      const pageOrders = await wooResponse.json();
      wooOrders.push(...pageOrders);
      if (pageOrders.length < 100) break;
    }
    const [customerTermsResponse, manualPaymentsResponse] = await Promise.all([
      fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_app_customers?select=id,payment_terms`, { headers: profile.headers }),
      fetch(`${process.env.SUPABASE_URL}/rest/v1/order_payment_entries?select=*`, { headers: profile.headers }),
    ]);
    const customerTerms = new Map((customerTermsResponse.ok ? await customerTermsResponse.json() : [])
      .map((item) => [`app-${item.id}`, item.payment_terms?.length ? item.payment_terms : [30]]));
    const manualPayments = manualPaymentsResponse.ok ? await manualPaymentsResponse.json() : [];

    const orders = wooOrders
      .map(order => ({order, attribution:attributionIndex.resolve(order)}))
      .filter(({order,attribution}) => attributionIndex.visible(order,profile,attribution))
      .map(({order,attribution}) => {
        const customerReference = metaValue(order, '_odr_customer_reference') || '';
        const agentProfileId = metaValue(order, '_odr_agent_profile_id') || '';
        const agentEntity = attribution.agent;
        const commissionBase = (order.line_items || [])
          .reduce((sum, line) => sum + (Number(line.total) || 0), 0);
        const commissionRate = Number(agentEntity?.commission_rate) || 0;
        const terms = customerTerms.get(customerReference) || [30];
        const recorded = manualPayments.filter((entry) => Number(entry.woo_order_id) === Number(order.id));
        const totalCents = Math.round((Number(order.total) || 0) * 100);
        const baseCents = Math.floor(totalCents / terms.length);
        const installments = terms.map((days, index) => {
          const due = new Date(order.date_created || Date.now());
          due.setUTCDate(due.getUTCDate() + Number(days));
          const saved = recorded.find((entry) => Number(entry.installment_number) === index + 1);
          return {
            number: index + 1, days: Number(days), dueDate: due.toISOString().slice(0, 10),
            amount: ((index === terms.length - 1 ? totalCents - baseCents * index : baseCents) / 100),
            paid: Boolean(order.date_paid || saved?.paid), paidAt: order.date_paid?.slice(0, 10) || saved?.paid_at || '',
          };
        });
        const paymentStatus = installments.every((item) => item.paid) ? 'paid' : installments.some((item) => item.paid) ? 'partial' : 'unpaid';
        const agentEarning = paymentStatus === 'paid' && !['cancelled', 'failed', 'refunded'].includes(order.status)
          ? commissionBase * commissionRate
          : 0;
        return {
          id: `WC-${order.id}`,
          date: order.date_created?.slice(0, 10) || '',
          customer: `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || order.billing?.email || 'Cliente',
          customerEmail: order.billing?.email || '',
          amount: Number(order.total) || 0,
          taxAmount: Number(order.total_tax) || 0,
          shippingNetAmount: Number(order.shipping_total) || 0,
          shippingAmount: Number(order.shipping_total) || 0,
          coupon: order.coupon_lines?.map((coupon) => coupon.code).join(', ') || '',
          center: attribution.center?.name || '',
          agent: agentEntity?.name || '',
          agentEntityId: agentEntity?.id || '',
          distributor: attribution.distributor?.name || '',
          distributorEntityId: attribution.distributor?.id || '',
          assignmentMode: attribution.source,
          assignmentEntityId: attribution.entityId,
          assignmentConflict: attribution.conflict,
          status: order.status,
          paymentStatus,
          installments,
          agentProfileId,
          commissionBase,
          commissionRate,
          agentEarning,
          items: (order.line_items || []).map((line) => ({
            productId: Number(line.product_id) || 0,
            name: line.name || 'Prodotto',
            quantity: Number(line.quantity) || 0,
            total: Number(line.total) || 0,
            taxAmount: Number(line.total_tax) || 0,
          })),
          shippingAddress: [
            order.shipping?.address_1 || order.billing?.address_1,
            order.shipping?.postcode || order.billing?.postcode,
            order.shipping?.city || order.billing?.city,
            order.shipping?.state || order.billing?.state,
          ].filter(Boolean).join(', '),
          shippingCity: order.shipping?.city || order.billing?.city || '',
          shippingState: order.shipping?.state || order.billing?.state || '',
          shippingCountry: order.shipping?.country || order.billing?.country || 'IT',
          paymentMethod: order.payment_method_title || '',
        };
      });
    return json(response, 200, { orders, assignmentOptions:profile.role==='admin'?attributionIndex.options:[], warnings:attributionIndex.warnings });
  } catch (error) {
    console.error('orders_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Ordini WooCommerce non disponibili' });
  }
}
