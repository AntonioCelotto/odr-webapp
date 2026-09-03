import { Buffer } from 'node:buffer';

function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(body));
}

const clean = (value, max = 250) => String(value || '').trim().slice(0, max);

async function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !base || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const auth = await fetch(`${base}/auth/v1/user`, { headers });
  if (!auth.ok) return null;
  const user = await auth.json();
  const result = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=id,role,approval_status,network_entity_id`, { headers });
  const [profile] = result.ok ? await result.json() : [];
  return profile?.approval_status === 'approved' && ['agent', 'admin'].includes(profile.role)
    ? { ...profile, headers }
    : null;
}

function wooHeaders() {
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('WooCommerce non configurato');
  return { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` };
}

async function agentEntity(profile) {
  if (profile.role === 'admin') return null;
  if (!profile.network_entity_id) throw new Error('Agente non collegato alla rete commerciale');
  return profile.network_entity_id;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Metodo non consentito' });
  try {
    const profile = await authenticate(req);
    if (!profile) return json(res, 403, { error: 'Funzione riservata agli agenti' });
    const parentId = profile.network_entity_id || null;
    const base = process.env.SUPABASE_URL;
    const customerHeaders = { ...profile.headers, 'Content-Type': 'application/json' };

    if (req.method === 'DELETE') {
      const customerId = clean(req.body?.customerId, 80).replace(/^app-/, '');
      if (!customerId) return json(res, 400, { error: 'Cliente non valido' });
      const deleteUrl = new URL('/rest/v1/agent_app_customers', base);
      deleteUrl.searchParams.set('id', `eq.${customerId}`);
      deleteUrl.searchParams.set('agent_profile_id', `eq.${profile.id}`);
      const deleted = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { ...customerHeaders, Prefer: 'return=representation' },
      });
      const rows = deleted.ok ? await deleted.json() : [];
      if (!deleted.ok || !rows.length) return json(res, 404, { error: 'Cliente non trovato o non eliminabile' });
      return json(res, 200, { deleted: true });
    }

    if (req.method === 'GET') {
      const customers = new Map();
      const appUrl = new URL('/rest/v1/agent_app_customers', base);
      appUrl.searchParams.set('agent_profile_id', `eq.${profile.id}`);
      appUrl.searchParams.set('active', 'eq.true');
      appUrl.searchParams.set('select', '*');
      appUrl.searchParams.set('order', 'name.asc');
      const appResult = await fetch(appUrl, { headers: customerHeaders });
      if (!appResult.ok) throw new Error('Archivio clienti app non disponibile');
      for (const item of await appResult.json()) {
        customers.set(`app-${item.id}`, {
          id: `app-${item.id}`,
          name: item.name,
          company: item.company || '',
          email: item.email,
          phone: item.phone || '',
          area: item.city || '',
          source: 'app',
          taxCode: item.tax_code || '', vatNumber: item.vat_number || '', pec: item.pec || '', sdiCode: item.sdi_code || '',
          paymentTerms: item.payment_terms?.length ? item.payment_terms : [30], notes: item.notes || '',
          orders: [],
          address: {
            firstName: item.name.split(/\s+/)[0] || item.name,
            lastName: item.name.split(/\s+/).slice(1).join(' '),
            company: item.company || '',
            address1: item.address_1 || '',
            address2: item.address_2 || '',
            postcode: item.postcode || '',
            city: item.city || '',
            state: item.state || '',
            country: item.country || 'IT',
            phone: item.phone || '',
            email: item.email,
          },
          shipping: {
            name: item.shipping_name || '', company: item.shipping_company || '', address1: item.shipping_address_1 || '',
            address2: item.shipping_address_2 || '', postcode: item.shipping_postcode || '', city: item.shipping_city || '',
            state: item.shipping_state || '', country: item.shipping_country || 'IT',
          },
        });
      }
      for (let page = 1; page <= 5; page += 1) {
        const url = new URL('/wp-json/wc/v3/orders', process.env.WOOCOMMERCE_STORE_URL);
        url.searchParams.set('per_page', '100');
        url.searchParams.set('page', String(page));
        url.searchParams.set('orderby', 'date');
        url.searchParams.set('order', 'desc');
        const result = await fetch(url, { headers: wooHeaders() });
        if (!result.ok) {
          if (result.status === 400 && page > 1) break;
          throw new Error('Clienti WooCommerce non disponibili');
        }
        const orders = await result.json();
        for (const order of orders) {
          const billing = order.billing || {};
          const email = String(billing.email || '').toLowerCase();
          const key = Number(order.customer_id) > 0 ? `wc-${order.customer_id}` : email;
          const referencedAgent = (order.meta_data || []).find((meta) => meta.key === '_odr_agent_profile_id')?.value;
          const referencedCustomer = (order.meta_data || []).find((meta) => meta.key === '_odr_customer_reference')?.value;
          if (profile.role === 'agent' && referencedAgent !== profile.id) continue;
          const referencedTarget = referencedAgent === profile.id && referencedCustomer
            ? [...customers.values()].find((customer) => customer.id === referencedCustomer)
            : null;
          if (referencedTarget) {
            referencedTarget.orders.push({
              id: `WC-${order.id}`,
              date: order.date_created?.slice(0, 10) || '',
              total: Number(order.total) || 0,
              status: order.status || '',
              paid: Boolean(order.date_paid),
            });
            continue;
          }
          if (!key) continue;
          if (!customers.has(key)) customers.set(key, {
            id: Number(order.customer_id) > 0 ? `wc-${order.customer_id}` : `order-${order.id}`,
            name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || billing.company || email || 'Cliente',
            company: billing.company || '',
            email,
            phone: billing.phone || '',
            area: billing.city || '',
            source: 'woocommerce',
            orders: [],
            address: {
              firstName: billing.first_name || '',
              lastName: billing.last_name || '',
              company: billing.company || '',
              address1: billing.address_1 || '',
              address2: billing.address_2 || '',
              postcode: billing.postcode || '',
              city: billing.city || '',
              state: billing.state || '',
              country: billing.country || 'IT',
              phone: billing.phone || '',
              email,
            },
          });
          const agentProfileId = (order.meta_data || []).find((meta) => meta.key === '_odr_agent_profile_id')?.value;
          const customerReference = (order.meta_data || []).find((meta) => meta.key === '_odr_customer_reference')?.value;
          if (agentProfileId === profile.id) {
            const target = [...customers.values()].find((customer) => customer.id === customerReference)
              || [...customers.values()].find((customer) => customer.id === (Number(order.customer_id) > 0 ? `wc-${order.customer_id}` : `order-${order.id}`))
              || [...customers.values()].find((customer) => customer.email && customer.email.toLowerCase() === email);
            if (target) target.orders.push({
              id: `WC-${order.id}`,
              date: order.date_created?.slice(0, 10) || '',
              total: Number(order.total) || 0,
              status: order.status || '',
              paid: Boolean(order.date_paid),
            });
          }
        }
        if (orders.length < 100) break;
      }
      return json(res, 200, { customers: [...customers.values()] });
    }

    const body = req.body || {};
    const email = clean(body.email, 200).toLowerCase();
    const name = clean(body.name);
    if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Nome ed email validi sono obbligatori' });
    const editingId = clean(body.customerId, 80).replace(/^app-/, '');
    const duplicateUrl = new URL('/rest/v1/agent_app_customers', base);
    duplicateUrl.searchParams.set('agent_profile_id', `eq.${profile.id}`);
    duplicateUrl.searchParams.set('email', `eq.${email}`);
    duplicateUrl.searchParams.set('select', 'id');
    const duplicate = await fetch(duplicateUrl, { headers: customerHeaders });
    const duplicates = await duplicate.json();
    if (duplicates.some((row) => row.id !== editingId)) return json(res, 409, { error: 'Questo cliente è già presente' });

    const parts = name.split(/\s+/);
    const firstName = parts.shift() || name;
    const lastName = parts.join(' ');
    const saveUrl = new URL('/rest/v1/agent_app_customers', base);
    if (req.method === 'PUT') {
      if (!editingId) return json(res, 400, { error: 'Cliente non valido' });
      saveUrl.searchParams.set('id', `eq.${editingId}`);
      saveUrl.searchParams.set('agent_profile_id', `eq.${profile.id}`);
    }
    const terms = Array.isArray(body.paymentTerms) ? body.paymentTerms.map(Number).filter((n) => [30, 60, 90, 120].includes(n)) : [];
    const create = await fetch(saveUrl, {
      method: req.method === 'PUT' ? 'PATCH' : 'POST',
      headers: { ...customerHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        agent_profile_id: profile.id,
        name,
        company: clean(body.company) || null,
        email,
        phone: clean(body.phone, 60) || null,
        address_1: clean(body.address1, 160) || null,
        postcode: clean(body.postcode, 20) || null,
        city: clean(body.city, 100) || null,
        state: clean(body.state, 10).toUpperCase() || null,
        country: 'IT',
        tax_code: clean(body.taxCode, 32) || null, vat_number: clean(body.vatNumber, 32) || null,
        pec: clean(body.pec, 200) || null, sdi_code: clean(body.sdiCode, 20) || null,
        shipping_name: clean(body.shippingName) || null, shipping_company: clean(body.shippingCompany) || null,
        shipping_address_1: clean(body.shippingAddress1, 160) || null, shipping_postcode: clean(body.shippingPostcode, 20) || null,
        shipping_city: clean(body.shippingCity, 100) || null,
        shipping_state: clean(body.shippingState, 10).toUpperCase() || null, shipping_country: 'IT',
        payment_terms: terms.length ? terms : [30], notes: clean(body.notes, 1000) || null,
        updated_at: new Date().toISOString(),
      }),
    });
    const [saved] = create.ok ? await create.json() : [];
    if (!saved) throw new Error('Salvataggio cliente nell’app non riuscito');
    return json(res, req.method === 'PUT' ? 200 : 201, { customer: {
      id: `app-${saved.id}`, name, email, phone: clean(body.phone, 60), area: clean(body.city, 100), source: 'app',
      address: {
        firstName, lastName, company: clean(body.company), address1: clean(body.address1, 160),
        address2: '', postcode: clean(body.postcode, 20), city: clean(body.city, 100),
        state: clean(body.state, 10).toUpperCase(), country: 'IT',
        phone: clean(body.phone, 60), email,
      }
    } });
  } catch (error) {
    console.error('agent_customers_error', error instanceof Error ? error.message : error);
    return json(res, 502, { error: error instanceof Error ? error.message : 'Operazione non riuscita' });
  }
}
