export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Metodo non consentito'});
  let body = req.body;
  if (typeof body === 'string') { try { body=JSON.parse(body); } catch { return res.status(400).json({valid:false}); } }
  const code = String(body?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) return res.status(200).json({valid:false});
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return res.status(503).json({error:'Verifica codice non disponibile. Riprova.'});
  try {
    const response = await fetch(`${base}/rest/v1/rpc/check_registration_code`, {
      method: 'POST', headers: { apikey:key, 'Content-Type':'application/json' },
      body: JSON.stringify({supplied_code:code}), signal:AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Code lookup failed');
    const valid = (await response.json()) === true;
    return res.status(200).json({valid});
  } catch {
    return res.status(503).json({error:'Verifica codice non disponibile. Riprova.'});
  }
}
