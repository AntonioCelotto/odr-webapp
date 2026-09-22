import { normalizeIdentity } from './_agent-identity.js';

export const assignmentKey = '_odr_order_assignment';
export const metaValue = (order, key) => (order.meta_data || []).find(item => item.key === key)?.value;
const unique = rows => rows.length === 1 ? rows[0] : null;

// All lookups stay on the server. Only the authorized order projection is returned.
export function createAttributionIndex(network, profiles, accounts, appCustomers) {
  const byId = new Map(network.map(entity => [entity.id, entity]));
  const commercial = network.filter(entity => ['agent', 'distributor'].includes(entity.type));
  const profileEntity = profile => byId.get(profile?.network_entity_id)
    || unique(commercial.filter(entity => entity.type === profile?.role && (
      (profile?.email && normalizeIdentity(entity.email) === normalizeIdentity(profile.email))
      || (Number(profile?.wordpress_user_id) > 0 && entity.external_code === `WP-${profile.wordpress_user_id}`)
    )));
  const byProfile = new Map(profiles.map(profile => [profile.id, profileEntity(profile)]));
  const byWp = new Map();
  const addWp = (id, entity) => {
    if (!(Number(id) > 0) || !entity) return;
    const key = Number(id);
    if (!byWp.has(key)) byWp.set(key, entity);
    else if (byWp.get(key)?.id !== entity.id) byWp.set(key, null);
  };
  commercial.forEach(entity => addWp(/^WP-(\d+)$/i.exec(entity.external_code || '')?.[1], entity));
  profiles.forEach(profile => addWp(profile.wordpress_user_id, byProfile.get(profile.id)));
  accounts.forEach(account => addWp(account.wordpress_user_id, byProfile.get(account.connected_profile_id)
    || unique(commercial.filter(entity => account.email && normalizeIdentity(entity.email) === normalizeIdentity(account.email)))));
  const byCustomerId = new Map(); const byCustomerEmail = new Map();
  const add = (map, key, entity) => {
    if (!key || !entity) return;
    const candidates = map.get(key) || new Map();
    candidates.set(entity.id, entity); map.set(key, candidates);
  };
  const addCustomer = (id, email, entity) => {
    if (Number(id) > 0) add(byCustomerId, Number(id), entity);
    add(byCustomerEmail, normalizeIdentity(email), entity);
  };
  const appById = new Map();
  appCustomers.forEach(customer => {
    const entity = byProfile.get(customer.agent_profile_id);
    appById.set(`app-${customer.id}`, entity);
    if (customer.active !== false) addCustomer(null, customer.email, entity);
  });
  const addWooCustomer = customer => {
    const values = new Map((customer.meta_data || []).map(item => [item.key, item.value]));
    const idEntity = byWp.get(Number(values.get('agente_wp_user_id')));
    const keys = ['nome_agente', 'agente_email', 'email_agente'].map(key => normalizeIdentity(values.get(key))).filter(Boolean);
    const entity = idEntity || unique(commercial.filter(entity => entity.type === 'agent' && keys.some(key => key === normalizeIdentity(entity.email) || key === normalizeIdentity(entity.name))));
    addCustomer(customer.id, customer.email || customer.billing?.email, entity);
  };
  const resolve = order => {
    const manual = metaValue(order, assignmentKey);
    let entity; let source = 'automatic'; let conflict = false;
    if (manual?.mode === 'manual') {
      entity = byId.get(manual.entityId);
      source = 'manual';
      // A saved assignment must never silently fall back to another owner.
      if (!entity) return { agent: null, distributor: null, entityId: manual.entityId, source, conflict: true };
    } else {
      entity = byId.get(metaValue(order, '_odr_agent_entity_id'))
        || byProfile.get(metaValue(order, '_odr_agent_profile_id'))
        || appById.get(metaValue(order, '_odr_customer_reference'));
      if (!entity) {
        const candidates = byCustomerId.get(Number(order.customer_id)) || byCustomerEmail.get(normalizeIdentity(order.billing?.email));
        if (candidates?.size === 1) entity = [...candidates.values()][0];
        else if (candidates?.size > 1) conflict = true;
      }
      if (!entity && !conflict) {
        const customer = unique(network.filter(item => order.billing?.email && normalizeIdentity(item.email) === normalizeIdentity(order.billing.email)));
        entity = customer?.type === 'center' ? byId.get(customer.parent_id) : customer;
      }
    }
    const center = unique(network.filter(item => item.type === 'center' && order.billing?.email && normalizeIdentity(item.email) === normalizeIdentity(order.billing.email)));
    const agent = entity?.type === 'agent' ? entity : null;
    const parent = agent ? byId.get(agent.parent_id) : null;
    const distributor = entity?.type === 'distributor' ? entity : parent?.type === 'distributor' ? parent : null;
    return { agent, distributor, center, entityId: entity?.id || '', source, conflict };
  };
  const visible = (order, profile, attribution) => {
    if (profile.role === 'admin') return true;
    if (profile.email && normalizeIdentity(order.billing?.email) === normalizeIdentity(profile.email)) return true;
    const own = profileEntity(profile);
    if (!own) return false;
    if (profile.role === 'agent') return attribution.agent?.id === own.id;
    if (profile.role === 'distributor') return attribution.distributor?.id === own.id;
    return false;
  };
  return { resolve, visible, addCustomer, addWooCustomer, byWp, byId };
}

export async function loadAttributionIndex(wooAuthorization) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Configurazione associazioni ordini non disponibile');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function rows(table, select) {
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const url = new URL(`/rest/v1/${table}`, process.env.SUPABASE_URL);
      url.searchParams.set('select', select); url.searchParams.set('order', 'id.asc');
      url.searchParams.set('offset', offset); url.searchParams.set('limit', '1000');
      const response = await fetch(url, {headers, cache:'no-store'});
      if (!response.ok) throw new Error(`Archivio associazioni ${table} non disponibile`);
      const page = await response.json(); all.push(...page);
      if (page.length < 1000) return all;
    }
  }
  const [network, profiles, accounts, customers] = await Promise.all([
    rows('network_entities','id,type,name,email,parent_id,external_code,commission_rate,active'),
    rows('profiles','id,email,role,network_entity_id,wordpress_user_id'),
    rows('wordpress_accounts','id,wordpress_user_id,email,connected_profile_id'),
    rows('agent_app_customers','id,email,agent_profile_id,active'),
  ]);
  const index = createAttributionIndex(network, profiles, accounts, customers);
  const warnings = [];
  const agentEntries = [...index.byWp].filter(([,entity]) => entity?.type === 'agent');
  // Bounded parallel reads of the same WordPress assignments used by Gestione clienti.
  for (let offset=0; offset<agentEntries.length; offset+=5) {
    await Promise.all(agentEntries.slice(offset, offset+5).map(async ([id, entity]) => {
      const url = new URL('/wp-json/wc/v3/odr-agent-customers', process.env.WOOCOMMERCE_STORE_URL);
      url.searchParams.set('agent_id',id);
      const response = await fetch(url, {headers:{Authorization:wooAuthorization},cache:'no-store',signal:AbortSignal.timeout(15000)}).catch(()=>null);
      if (!response?.ok) { warnings.push('Alcune associazioni WordPress non sono disponibili: i canali potrebbero essere incompleti.'); return; }
      const payload = await response.json();
      (payload.customers || []).forEach(customer => index.addCustomer(customer.id,customer.email,entity));
    }));
  }
  for(let page=1; ; page++) {
    const url = new URL('/wp-json/wc/v3/customers', process.env.WOOCOMMERCE_STORE_URL);
    url.searchParams.set('per_page','100'); url.searchParams.set('page',page);
    const response = await fetch(url,{headers:{Authorization:wooAuthorization}});
    if(!response.ok) throw new Error('Anagrafiche WooCommerce non disponibili');
    const customers = await response.json(); customers.forEach(index.addWooCustomer);
    if(customers.length<100) break;
  }
  return {...index, warnings:[...new Set(warnings)], options:network.filter(entity=>entity.active && ['agent','distributor'].includes(entity.type)).map(({id,type,name})=>({id,type,name}))};
}
