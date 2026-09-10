import { Buffer } from 'node:buffer';
import { customerBelongsToAgent, getAgentIdentity, getWordPressAgentCustomers, normalizeIdentity } from './_agent-identity.js';

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
  if (request.method !== 'GET') return json(response, 405, { error: 'Metodo non consentito' });
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const profile = token ? await getProfile(token) : null;
    if (!profile) return json(response, 403, { error: 'Accesso richiesto' });
    const authorization = `Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}`;
    const wooOrders = [];
    for (let page = 1; page <= 5; page += 1) {
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
    const assignedWooCustomerIds = new Set();
    const assignedWooCustomerEmails = new Set();
    const wooCustomerAgentsById = new Map();
    const wooCustomerAgentsByEmail = new Map();
    const agentIdentity = profile.role === 'agent' ? await getAgentIdentity(profile) : null;
    const wordpressAssignments = profile.role === 'agent'
      ? await getWordPressAgentCustomers(profile)
      : { customerIds: new Set(), customerEmails: new Set() };
    wordpressAssignments.customerIds.forEach((id) => assignedWooCustomerIds.add(id));
    wordpressAssignments.customerEmails.forEach((email) => assignedWooCustomerEmails.add(email));
    if (['agent', 'admin'].includes(profile.role)) {
      for (let page = 1; page <= 10; page += 1) {
        const customerUrl = new URL('/wp-json/wc/v3/customers', process.env.WOOCOMMERCE_STORE_URL);
        customerUrl.searchParams.set('per_page', '100');
        customerUrl.searchParams.set('page', String(page));
        const customerResponse = await fetch(customerUrl, { headers: { Authorization: authorization } });
        if (!customerResponse.ok) {
          if (customerResponse.status === 400 && page > 1) break;
          throw new Error(`WooCommerce clienti ${customerResponse.status}`);
        }
        const wooCustomers = await customerResponse.json();
        for (const customer of wooCustomers) {
          const email = normalizeIdentity(customer.email || customer.billing?.email);
          const assignedAgentId = (customer.meta_data || []).find((item) => item?.key === 'agente_wp_user_id')?.value;
          const assignedAgentName = (customer.meta_data || []).find((item) => item?.key === 'nome_agente')?.value;
          const assignment = { wordpressUserId: Number(assignedAgentId) || 0, name: String(assignedAgentName || '').trim() };
          if (assignment.wordpressUserId || assignment.name) {
            wooCustomerAgentsById.set(Number(customer.id), assignment);
            if (email) wooCustomerAgentsByEmail.set(email, assignment);
          }
          if (profile.role === 'agent' && customerBelongsToAgent(customer.meta_data, agentIdentity)) {
            assignedWooCustomerIds.add(Number(customer.id));
            if (email) assignedWooCustomerEmails.add(email);
          }
        }
        if (wooCustomers.length < 100) break;
      }
    }
    const networkResponse = await fetch(
      `${process.env.SUPABASE_URL}/functions/v1/network-management`,
      { headers: profile.headers },
    );
    const networkPayload = networkResponse.ok ? await networkResponse.json() : {};
    const network = networkPayload.entities || [];
    const byId = new Map(network.map((entity) => [entity.id, entity]));
    const byEmail = new Map(network
      .filter((entity) => entity.email)
      .map((entity) => [entity.email.toLowerCase(), entity]));
    const agentsByName = new Map(network
      .filter((entity) => entity.type === 'agent' && entity.name)
      .map((entity) => [normalizeIdentity(entity.name), entity]));
    const agentsByWordPressId = new Map(network
      .filter((entity) => entity.type === 'agent' && /^WP-\d+$/i.test(entity.external_code || ''))
      .map((entity) => [Number(String(entity.external_code).slice(3)), entity]));
    const agentCustomerEmails = new Set(profile.role === 'agent' && profile.network_entity_id
      ? network
        .filter((entity) => entity.type === 'center' && entity.parent_id === profile.network_entity_id && entity.email)
        .map((entity) => entity.email.toLowerCase())
      : []);
    const [customerTermsResponse, manualPaymentsResponse] = await Promise.all([
      fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_app_customers?select=id,payment_terms`, { headers: profile.headers }),
      fetch(`${process.env.SUPABASE_URL}/rest/v1/order_payment_entries?select=*`, { headers: profile.headers }),
    ]);
    const customerTerms = new Map((customerTermsResponse.ok ? await customerTermsResponse.json() : [])
      .map((item) => [`app-${item.id}`, item.payment_terms?.length ? item.payment_terms : [30]]));
    const manualPayments = manualPaymentsResponse.ok ? await manualPaymentsResponse.json() : [];

    const orders = wooOrders
      .filter((order) => {
        const email = order.billing?.email?.toLowerCase() || '';
        const meta = order.meta_data || [];
        const agentProfileId = meta.find((item) => item.key === '_odr_agent_profile_id')?.value;
        const agentEntityId = meta.find((item) => item.key === '_odr_agent_entity_id')?.value;
        return profile.role === 'admin'
          || email === profile.email?.toLowerCase()
          || (profile.role === 'agent' && (
            agentCustomerEmails.has(email)
            || agentProfileId === profile.id
            || agentEntityId === profile.network_entity_id
            || assignedWooCustomerIds.has(Number(order.customer_id))
            || assignedWooCustomerEmails.has(email)
          ));
      })
      .map((order) => {
        const email = order.billing?.email?.toLowerCase() || '';
        const meta = order.meta_data || [];
        const customerReference = meta.find((item) => item.key === '_odr_customer_reference')?.value || '';
        const agentProfileId = meta.find((item) => item.key === '_odr_agent_profile_id')?.value || '';
        const orderAgentEntityId = meta.find((item) => item.key === '_odr_agent_entity_id')?.value || '';
        const entity = byEmail.get(email);
        const parent = entity?.parent_id ? byId.get(entity.parent_id) : null;
        const grandparent = parent?.parent_id ? byId.get(parent.parent_id) : null;
        const wooCustomerAgent = wooCustomerAgentsById.get(Number(order.customer_id)) || wooCustomerAgentsByEmail.get(normalizeIdentity(email));
        const assignedAgentEntity = agentsByWordPressId.get(wooCustomerAgent?.wordpressUserId)
          || agentsByName.get(normalizeIdentity(wooCustomerAgent?.name));
        const agentEntity = entity?.type === 'agent'
          ? entity
          : entity?.type === 'center' && parent?.type === 'agent' ? parent : byId.get(orderAgentEntityId) || assignedAgentEntity || null;
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
          coupon: order.coupon_lines?.map((coupon) => coupon.code).join(', ') || '',
          center: entity?.type === 'center' ? entity.name : '',
          agent: agentEntity?.name || wooCustomerAgent?.name || '',
          agentEntityId: agentEntity?.id || orderAgentEntityId,
          distributor: entity?.type === 'distributor'
            ? entity.name
            : entity?.type === 'agent' && parent?.type === 'distributor'
              ? parent.name
              : grandparent?.type === 'distributor' ? grandparent.name : '',
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
    return json(response, 200, { orders });
  } catch (error) {
    console.error('orders_error', error instanceof Error ? error.message : error);
    return json(response, 502, { error: 'Ordini WooCommerce non disponibili' });
  }
}
