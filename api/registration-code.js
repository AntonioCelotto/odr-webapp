export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Metodo non consentito'});
  let body = req.body;
  if (typeof body === 'string') { try { body=JSON.parse(body); } catch { return res.status(400).json({valid:false}); } }
  const code = String(body?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,64}$/.test(code)) return res.status(200).json({valid:false});
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return res.status(503).json({error:'Verifica codice non disponibile. Riprova.'});
  try {
    const query = new URLSearchParams({code:`eq.${code}`,select:'active,starts_at,ends_at,audience_role,max_uses,current_uses',limit:'1'});
    const response = await fetch(`${base}/rest/v1/validation_codes?${query}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Code lookup failed');
    const [row] = await response.json();
    const now = Date.now();
    const valid = Boolean(row?.active
      && (!row.starts_at || Date.parse(row.starts_at) <= now)
      && (!row.ends_at || Date.parse(row.ends_at) >= now)
      && (!row.audience_role || row.audience_role === 'patient')
      && (row.max_uses === null || row.current_uses < row.max_uses));
    return res.status(200).json({valid});
  } catch {
    return res.status(503).json({error:'Verifica codice non disponibile. Riprova.'});
  }
}
