import { Buffer } from 'node:buffer';

function reply(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return reply(res, 405, { error: 'Metodo non consentito' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply(res, 403, { error: 'Sezione riservata agli amministratori' });
    const base = process.env.SUPABASE_URL;
    const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` };
    const auth = await fetch(`${base}/auth/v1/user`, { headers });
    if (!auth.ok) return reply(res, 403, { error: 'Sessione non valida' });
    const user = await auth.json();
    const profileResult = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,approval_status`, { headers });
    const [profile] = profileResult.ok ? await profileResult.json() : [];
    if (profile?.role !== 'admin' || profile.approval_status !== 'approved') return reply(res, 403, { error: 'Sezione riservata agli amministratori' });
    const customers = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await fetch(`${base}/rest/v1/agent_app_customers?select=*&order=id.asc&limit=1000&offset=${offset}`, { headers });
      if (!result.ok) throw new Error('Archivio app non disponibile');
      const rows = await result.json();
      customers.push(...rows.map(c => ({
        id: `app-${c.id}`, name: c.name, company: c.company || '', email: c.email || '', phone: c.phone || '',
        address: [c.address_1, c.address_2, c.postcode, c.city, c.state, c.country].filter(Boolean).join(', '),
        vatNumber: c.vat_number || '', taxCode: c.tax_code || '', pec: c.pec || '', sdiCode: c.sdi_code || '',
      })));
      if (rows.length < 1000) break;
    }
    const wooHeaders = { Authorization: `Basic ${Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64')}` };
    for (let page = 1; ; page++) {
      const url = new URL('/wp-json/wc/v3/customers', process.env.WOOCOMMERCE_STORE_URL);
      url.search = new URLSearchParams({ per_page: '100', page: String(page), orderby: 'id', order: 'asc', role: 'all' }).toString();
      const result = await fetch(url, { headers: wooHeaders });
      if (!result.ok) throw new Error('Archivio WooCommerce non disponibile');
      const rows = await result.json();
      customers.push(...rows.map(c => {
        const b = c.billing || {};
        return { id: `wc-${c.id}`, name: `${c.first_name || b.first_name || ''} ${c.last_name || b.last_name || ''}`.trim() || b.company || c.email || 'Cliente',
          company: b.company || '', email: c.email || b.email || '', phone: b.phone || '',
          address: [b.address_1, b.address_2, b.postcode, b.city, b.state, b.country].filter(Boolean).join(', ') };
      }));
      const totalPages = Number(result.headers.get('x-wp-totalpages'));
      if (rows.length < 100 || (totalPages && page >= totalPages)) break;
    }
    return reply(res, 200, { customers });
  } catch {
    return reply(res, 502, { error: 'Anagrafica non disponibile. Riprova ad aggiornare.' });
  }
}
