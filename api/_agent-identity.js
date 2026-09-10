const normalizeIdentity = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function fetchRows(url, headers) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  return response.ok ? response.json() : [];
}

export async function getAgentIdentity(profile) {
  const names = new Set();
  const emails = new Set();
  const wordpressUserIds = new Set();
  const addName = (value) => {
    const normalized = normalizeIdentity(value);
    if (normalized) names.add(normalized);
  };
  const addEmail = (value) => {
    const normalized = normalizeIdentity(value);
    if (normalized) emails.add(normalized);
  };
  const addWordPressId = (value) => {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) wordpressUserIds.add(id);
  };

  addName(profile.full_name);
  addEmail(profile.email);
  addWordPressId(profile.wordpress_user_id);

  const base = process.env.SUPABASE_URL;
  if (!base || !profile.headers) return { names, emails, wordpressUserIds };
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const lookupHeaders = serviceRoleKey
    ? { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
    : profile.headers;

  const linkedAccountUrl = new URL('/rest/v1/wordpress_accounts', base);
  linkedAccountUrl.searchParams.set('connected_profile_id', `eq.${profile.id}`);
  linkedAccountUrl.searchParams.set('select', 'wordpress_user_id,email,full_name');
  const emailAccountUrl = new URL('/rest/v1/wordpress_accounts', base);
  emailAccountUrl.searchParams.set('email', `ilike.${profile.email}`);
  emailAccountUrl.searchParams.set('select', 'wordpress_user_id,email,full_name');
  const accountRows = await Promise.all([
    fetchRows(linkedAccountUrl, lookupHeaders),
    profile.email ? fetchRows(emailAccountUrl, lookupHeaders) : Promise.resolve([]),
  ]);
  const wordpressAccounts = [...new Map(accountRows.flat()
    .map((account) => [Number(account.wordpress_user_id), account])).values()];
  for (const account of wordpressAccounts) {
    addName(account.full_name);
    addEmail(account.email);
    addWordPressId(account.wordpress_user_id);
  }

  const entityUrl = new URL('/rest/v1/network_entities', base);
  entityUrl.searchParams.set('type', 'eq.agent');
  entityUrl.searchParams.set('active', 'eq.true');
  entityUrl.searchParams.set('select', 'id,name,email,external_code');
  const entities = await fetchRows(entityUrl, lookupHeaders);
  for (const entity of entities) {
    const externalMatch = String(entity.external_code || '').match(/^WP-(\d+)$/i);
    const matchesProfile = entity.id === profile.network_entity_id
      || emails.has(normalizeIdentity(entity.email))
      || names.has(normalizeIdentity(entity.name))
      || (externalMatch && wordpressUserIds.has(Number(externalMatch[1])));
    if (!matchesProfile) continue;
    addName(entity.name);
    addEmail(entity.email);
    if (externalMatch) addWordPressId(externalMatch[1]);
  }

  return { names, emails, wordpressUserIds };
}

export function customerBelongsToAgent(metadata, identity) {
  const values = new Map((metadata || []).map((item) => [String(item?.key || ''), item?.value]));
  const assignedAgentId = values.get('agente_wp_user_id');
  if (identity.wordpressUserIds.has(Number(assignedAgentId))) return true;

  const assignedValues = [
    values.get('nome_agente'),
    values.get('agente_email'),
    values.get('email_agente'),
  ].map(normalizeIdentity).filter(Boolean);
  return assignedValues.some((value) => identity.names.has(value) || identity.emails.has(value));
}

export { normalizeIdentity };
