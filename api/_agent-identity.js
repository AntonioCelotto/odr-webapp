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

  const requests = [];
  if (profile.network_entity_id) {
    const entityUrl = new URL('/rest/v1/network_entities', base);
    entityUrl.searchParams.set('id', `eq.${profile.network_entity_id}`);
    entityUrl.searchParams.set('select', 'name,email,external_code');
    requests.push(fetchRows(entityUrl, lookupHeaders));
  } else {
    requests.push(Promise.resolve([]));
  }

  const accountUrl = new URL('/rest/v1/wordpress_accounts', base);
  accountUrl.searchParams.set('connected_profile_id', `eq.${profile.id}`);
  accountUrl.searchParams.set('select', 'wordpress_user_id,email,full_name');
  requests.push(fetchRows(accountUrl, lookupHeaders));

  const [entities, wordpressAccounts] = await Promise.all(requests);
  for (const entity of entities) {
    addName(entity.name);
    addEmail(entity.email);
    const externalMatch = String(entity.external_code || '').match(/^WP-(\d+)$/i);
    if (externalMatch) addWordPressId(externalMatch[1]);
  }
  for (const account of wordpressAccounts) {
    addName(account.full_name);
    addEmail(account.email);
    addWordPressId(account.wordpress_user_id);
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
