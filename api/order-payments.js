function json(res, status, body) {
  res.status(status); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store'); res.send(JSON.stringify(body));
}

async function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const base = process.env.SUPABASE_URL; const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const auth = token && await fetch(`${base}/auth/v1/user`, { headers });
  if (!auth?.ok) return null;
  const user = await auth.json();
  const result = await fetch(`${base}/rest/v1/profiles?id=eq.${user.id}&select=id,role,approval_status`, { headers });
  const [profile] = result.ok ? await result.json() : [];
  return profile?.approval_status === 'approved' && ['agent', 'admin'].includes(profile.role) ? { ...profile, headers } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Metodo non consentito' });
  try {
    const profile = await authenticate(req);
    if (!profile) return json(res, 403, { error: 'Operazione non autorizzata' });
    if (profile.role !== 'agent') return json(res, 403, { error: 'Il pagamento deve essere registrato dall’agente dell’ordine' });
    const wooOrderId = Number(req.body?.wooOrderId); const installmentNumber = Number(req.body?.installmentNumber);
    const dueDate = String(req.body?.dueDate || ''); const paidAt = String(req.body?.paidAt || '');
    const amount = Number(req.body?.amount);
    if (!wooOrderId || !installmentNumber || !dueDate || !paidAt || amount < 0) return json(res, 400, { error: 'Dati del pagamento non validi' });
    const url = new URL('/rest/v1/order_payment_entries', process.env.SUPABASE_URL);
    url.searchParams.set('on_conflict', 'woo_order_id,installment_number');
    const result = await fetch(url, { method: 'POST', headers: { ...profile.headers, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({
      woo_order_id: wooOrderId, agent_profile_id: profile.id, installment_number: installmentNumber,
      due_date: dueDate, amount, paid: true, paid_at: paidAt, updated_at: new Date().toISOString(),
    }) });
    const rows = result.ok ? await result.json() : [];
    if (!result.ok || !rows.length) throw new Error('Registrazione del pagamento non riuscita');
    return json(res, 200, { payment: rows[0] });
  } catch (error) {
    return json(res, 502, { error: error instanceof Error ? error.message : 'Operazione non riuscita' });
  }
}
