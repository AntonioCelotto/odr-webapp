Warning: truncated output (original token count: 45351)
Total output lines: 3679

import { mountCourseAssignments } from './course-assignments.js';
import { createBankCheckout } from './bank-checkout.js';
import { createClient } from '@supabase/supabase-js';

// Capture the recovery route before Supabase consumes the URL fragment.
const initialRecoveryRoute = window.location.pathname === '/recupera-password'
  || window.location.hash.includes('type=recovery')
  || window.location.hash.includes('error=');

const runtimeConfig = window.__ODR_CONFIG__ || {};
const config = {
  supabaseUrl: runtimeConfig.supabaseUrl || '',
  supabasePublishableKey: runtimeConfig.supabasePublishableKey || '',
  wooBaseUrl: runtimeConfig.wooBaseUrl || 'https://odr.ioxina.com',
  wooShopPath: '/shop',
  bankCheckoutEnabled: runtimeConfig.bankCheckoutEnabled === true,
};
const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
const supabase = isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabasePublishableKey)
  : null;

const roleLabels = {
  admin: 'Amministratore',
  distributor: 'Distributore',
  agent: 'Agente',
  center: 'Centro / punto vendita',
  patient: 'Cliente',
};

let validationCodes = [];
let promotions = [];
let codeValidations = [];

let networkRows = [];
let networkAccounts = [];
let agentCustomers = [];
let selectedAgentCustomer = null;
let canManageNetwork = false;

let reportOrders = [];
let filteredReportOrders = [];
let orderAssignmentOptions = [];

const moduleLabels = {
  dashboard: 'Dashboard',
  codes: 'Codici e convenzioni',
  promotions: 'Promozioni',
  network: 'Rete commerciale',
  wordpress: 'WordPress / shop',
  reports: 'Ordini',
  users: 'Gestione utenti',
  permissions: 'Ruoli e permessi',
};

const appRoutes = {
  'course-assignments': { path: '/corsi-da-assegnare', title: 'Corsi da assegnare' },
  dashboard: { path: '/dashboard', title: 'Dashboard' },
  shop: { path: '/shop', title: 'Shop' },
  'store-management': { path: '/gestione-store-locator', title: 'Store Locator' },
  marketing: { path: '/materiale-mkt', title: 'Materiale MKT' },
  profile: { path: '/profilo', title: 'Il mio profilo' },
  access: { path: '/codici', title: 'Codici e convenzioni' },
  promotions: { path: '/promozioni', title: 'Promozioni' },
  network: { path: '/rete', title: 'Rete commerciale' },
  'admin-customers': { path: '/clienti-fatturato', title: 'Clienti e fatturato' },
  'agent-customers': { path: '/clienti', title: 'Gestione clienti' },
  wordpress: { path: '/wordpress', title: 'WordPress e WooCommerce' },
  reports: { path: '/ordini', title: 'Ordini' },
  'admin-users': { path: '/utenti', title: 'Gestione utenti' },
  permissions: { path: '/permessi', title: 'Ruoli e permessi' },
  setup: { path: '/impostazioni', title: 'Impostazioni' },
};

let validatedCode = null;
let currentUser = null;
let authBusy = false;
let passwordRecoveryActive = initialRecoveryRoute;
let shopProducts = [];
let packageDocuments = [];
let marketingMaterials = [];
let shopCategory = 'all';
let shopOpening = false;
let shopCart = [];
let shopCoupon = '';
let shopQuote = null;
let shopAddressLoaded = false;

let disposeStoreLocator = null;
let storeLocatorLoading = false;
async function openStoreManagement() {
 if (!['admin','agent','distributor'].includes(currentUser?.role) || !supabase || storeLocatorLoading) return;
 const userId=currentUser.id;
 storeLocatorLoading=true;
 try {
  disposeStoreLocator?.(); disposeStoreLocator=null;
  const {mountLocator}=await import('./store-locator/view.js');
  if(currentUser?.role==='admin' && !(await loadNetwork()))throw new Error('Rete non disponibile');
  if(!['admin','agent','distributor'].includes(currentUser?.role)||currentUser.id!==userId)return;
  const cleanup=await mountLocator(byId('store-management-content'),supabase,currentUser.role,networkRows);
  if(!['admin','agent','distributor'].includes(currentUser?.role)||currentUser.id!==userId)cleanup();else disposeStoreLocator=cleanup;
 } catch {byId('store-management-content').textContent='Store Locator non disponibile. Riapri la sezione per riprovare.';}
 finally {storeLocatorLoading=false;}
}

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  return Number(value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function formatLastAccess(value) {
  if (!value) return 'Mai effettuato';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Mai effettuato';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Rome',
  }).format(date);
}

const dashboardMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'short' });

function dashboardOrderPaidAmount(order) {
  if (order.paymentStatus === 'paid') return Number(order.amount) || 0;
  return (order.installments || []).reduce((sum, item) => sum + (item.paid ? Number(item.amount) || 0 : 0), 0);
}

function dashboardPeriodStart(period) {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'year') return new Date(now.getFullYear(), 0, 1);
  const start = new Date(now);
  start.setDate(start.getDate() - Number(period || 365));
  start.setHours(0, 0, 0, 0);
  return start;
}

function dashboardDateValue(date) {
  return date ? new Date(`${date}T00:00:00`) : null;
}

function dashboardDateRange() {
  const period = byId('admin-dashboard-period')?.value || '365';
  const customFrom = dashboardDateValue(byId('admin-dashboard-date-from')?.value);
  const customTo = dashboardDateValue(byId('admin-dashboard-date-to')?.value);
  if (period === 'custom') return { start: customFrom, end: customTo };
  return { start: dashboardPeriodStart(period), end: new Date() };
}

function dashboardLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function syncDashboardDateInputs() {
  const period = byId('admin-dashboard-period')?.value || '365';
  if (period === 'custom') return;
  const start = dashboardPeriodStart(period);
  byId('admin-dashboard-date-from').value = start ? dashboardLocalDate(start) : '';
  byId('admin-dashboard-date-to').value = dashboardLocalDate(new Date());
}

let dashboardProfileId = '';

function dashboardProfiles() {
  return networkRows.filter(row => row.active && ['agent', 'distributor'].includes(row.type));
}

function dashboardSelectedProfile() {
  return currentUser?.role === 'admin' && dashboardProfileId
    ? dashboardProfiles().find(row => row.id === dashboardProfileId) || null : null;
}

function dashboardScopedOrders() {
  if (currentUser?.role !== 'admin' || !dashboardProfileId) return reportOrders;
  const profile = dashboardSelectedProfile();
  if (!profile) return [];
  const emails = networkAccounts.filter(account => account.network_entity_id === profile.id)
    .map(account => String(account.email || '').trim().toLowerCase()).filter(Boolean);
  return reportOrders.filter(order =>
    (profile.type === 'agent' ? order.agentEntityId === profile.id : order.distributorEntityId === profile.id)
    || emails.includes(String(order.customerEmail || '').trim().toLowerCase()));
}

function renderDashboardProfilePicker() {
  const wrap = byId('dashboard-profile-wrap');
  if (!wrap) return;
  wrap.hidden = currentUser?.role !== 'admin';
  const query = (byId('dashboard-profile-search').value || '').trim().toLowerCase();
  const profiles = dashboardProfiles();
  const options = profiles.filter(row => row.id === dashboardProfileId
    || [row.name, row.email, row.accountName].join(' ').toLowerCase().includes(query));
  byId('dashboard-profile-select').innerHTML = '<option value="">Tutta la rete</option>'
    + ['agent', 'distributor'].map(type => `<optgroup label="${type === 'agent' ? 'Agenti' : 'Distributori'}">${options.filter(row => row.type === type).sort((a,b) => a.name.localeCompare(b.name, 'it')).map(row => `<option value="${escapeHtml(row.id)}" ${row.id === dashboardProfileId ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}</optgroup>`).join('');
  const selected = dashboardSelectedProfile();
  byId('dashboard-profile-status').textContent = selected
    ? `Stai visualizzando: ${selected.name} — ${roleLabels[selected.type]}`
    : dashboardProfileId ? 'Profilo non più disponibile. Seleziona un altro profilo.' : 'Stai visualizzando: tutta la rete';
}

function selectDashboardProfile(id) {
  if (currentUser?.role !== 'admin') return;
  if (id && !dashboardProfiles().some(row => row.id === id)) return;
  dashboardProfileId = id;
  byId('dashboard-profile-search').value = '';
  byId('dashboard-detail-dialog')?.close();
  dashboardSalesExpanded.products = false;
  dashboardSalesExpanded.promotions = false;
  renderDashboardProfilePicker();
  renderAdminDashboard();
}

function dashboardFilteredOrders() {
  const { start, end } = dashboardDateRange();
  return dashboardScopedOrders().filter((order) => {
    if (['cancelled', 'failed', 'refunded', 'trash'].includes(String(order.status).toLowerCase())) return false;
    const orderDate = dashboardDateValue(order.date);
    return (!start || orderDate >= start) && (!end || orderDate <= end);
  });
}

function dashboardBarRows(rows, valueFormatter = money) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return rows.length ? rows.map((row) => `
    <div class="dashboard-bar-row">
      <div><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(valueFormatter(row.value))}</strong></div>
      ${row.gross !== undefined ? `<small>Totale lordo ${money(row.gross)}${row.quantity !== undefined ? ` · ${row.quantity} pz` : ''}</small>` : ''}
      <div class="dashboard-bar-track"><i style="width:${Math.max(4, (row.value / maximum) * 100)}%"></i></div>
    </div>`).join('') : '<div class="dashboard-empty">Nessun dato disponibile nel periodo.</div>';
}

function renderAdminSalesChart(orders) {
  const months = [];
  const now = new Date();
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: dashboardMonthFormatter.format(date).replace('.', ''), value: 0 });
  }
  orders.forEach((order) => {
    const month = months.find((item) => item.key === String(order.date).slice(0, 7));
    if (month) { month.value += dashboardOrderTaxable(order); month.gross = (month.gross || 0) + Number(order.amount || 0); }
  });
  const width = 760; const height = 250; const insetX = 72; const insetRight = 20; const insetTop = 18; const insetBottom = 28;
  const rawMax = Math.max(...months.map((item) => item.value), 1);
  const roughStep = rawMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
  const normalizedStep = roughStep / magnitude;
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
  const max = step * 4;
  const chartHeight = height - insetTop - insetBottom;
  const chartWidth = width - insetX - insetRight;
  const points = months.map((item, index) => ({ ...item, x: insetX + (index * chartWidth) / 11, y: insetTop + chartHeight - ((item.value / max) * chartHeight) }));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = step * index;
    const y = insetTop + chartHeight - ((value / max) * chartHeight);
    const label = value >= 1000 ? `${Number((value / 1000).toFixed(value % 1000 ? 1 : 0)).toLocaleString('it-IT')} mila €` : money(value).replace(',00', '');
    return `<line x1="${insetX}" y1="${y}" x2="${width - insetRight}" y2="${y}" class="dashboard-grid-line"/><text x="${insetX - 9}" y="${y + 4}" text-anchor="end" class="dashboard-axis-label">${label}</text>`;
  }).join('');
  const area = `${insetX},${insetTop + chartHeight} ${points.map((item) => `${item.x},${item.y}`).join(' ')} ${width - insetRight},${insetTop + chartHeight}`;
  byId('admin-sales-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Andamento mensile dell'imponibile con griglia valori"><defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#58735c" stop-opacity=".32"/><stop offset="1" stop-color="#58735c" stop-opacity=".02"/></linearGradient></defs>${grid}<line x1="${insetX}" y1="${insetTop}" x2="${insetX}" y2="${insetTop + chartHeight}" class="dashboard-axis"/><polygon points="${area}" fill="url(#salesFill)"/><polyline points="${points.map((item) => `${item.x},${item.y}`).join(' ')}" class="dashboard-line"/>${points.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="4" class="dashboard-point"><title>${item.label} · Imponibile: ${money(item.value)} · Totale lordo: ${money(item.gross)}</title></circle><text x="${item.x}" y="${height - 6}" text-anchor="middle">${item.label}</text>`).join('')}</svg>`;
}

const dashboardAreaProvinces = {
  'Nord Ovest': new Set(['AO', 'AL', 'AT', 'BI', 'CN', 'NO', 'TO', 'VB', 'VC', 'BG', 'BS', 'CO', 'CR', 'LC', 'LO', 'MB', 'MI', 'MN', 'PV', 'SO', 'VA', 'GE', 'IM', 'SP', 'SV']),
  'Nord Est': new Set(['BZ', 'TN', 'BL', 'PD', 'RO', 'TV', 'VE', 'VR', 'VI', 'BO', 'FC', 'FE', 'MO', 'PC', 'PR', 'RA', 'RE', 'RN', 'GO', 'PN', 'TS', 'UD']),
  Centro: new Set(['AR', 'FI', 'GR', 'LI', 'LU', 'MS', 'PI', 'PO', 'PT', 'SI', 'AN', 'AP', 'FM', 'MC', 'PU', 'FR', 'LT', 'RI', 'RM', 'VT', 'PG', 'TR']),
  Sud: new Set(['AQ', 'CH', 'PE', 'TE', 'CB', 'IS', 'AV', 'BN', 'CE', 'NA', 'SA', 'BA', 'BR', 'BT', 'FG', 'LE', 'TA', 'MT', 'PZ', 'CZ', 'CS', 'KR', 'RC', 'VV']),
  Isole: new Set(['AG', 'CL', 'CT', 'EN', 'ME', 'PA', 'RG', 'SR', 'TP', 'CA', 'NU', 'OR', 'SS', 'SU']),
};

function dashboardOrderPieces(order) {
  return (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function dashboardOrderTaxable(order) {
  const amount = Number(order.amount) || 0;
  const tax = Number(order.taxAmount) || 0;
  const shippingNet = Number(order.shippingNetAmount) || 0;
  const taxableProducts = amount - tax - shippingNet;
  if (amount || tax || shippingNet) return Math.max(0, Math.round((taxableProducts + Number.EPSILON) * 100) / 100);
  if (order.commissionBase !== undefined && order.commissionBase !== null) return Number(order.commissionBase) || 0;
  return (order.items || []).reduce((sum, item) => sum + (Number(item.total) || 0), 0);
}

function addDashboardProductSale(map, label, item) {
  const sale = map.get(label) || { value: 0, gross: 0, quantity: 0 };
  sale.value += Number(item.total) || 0;
  sale.gross += (Number(item.total) || 0) + (Number(item.taxAmount) || 0);
  sale.quantity += Number(item.quantity) || 0;
  map.set(label, sale);
}

function dashboardOrderArea(order) {
  const province = String(order.shippingState || order.shippingAddress?.split(',').at(-1) || '').trim().toUpperCase();
  return Object.entries(dashboardAreaProvinces).find(([, provinces]) => provinces.has(province))?.[0] || 'Non definita';
}

function renderItalyChart(orders) {
  const areas = new Map();
  orders.forEach((order) => {
    const area = dashboardOrderArea(order);
    const value = areas.get(area) || { taxable: 0, gross: 0 };
    value.taxable += dashboardOrderTaxable(order);
    value.gross += Number(order.amount) || 0;
    areas.set(area, value);
  });
  const total = [...areas.values()].reduce((sum, value) => sum + value.taxable, 0);
  const rows = [...areas.entries()];
  byId('admin-italy-chart').innerHTML = `
    <div class="italy-map-wrap"><img class="italy-silhouette" src="/italy-map.svg" alt="Cartina geografica dell'Italia" /><small>Cartina: Wikimedia Commons, CC BY-SA 3.0</small></div>
    <div class="dashboard-area-list">${rows.length ? rows.map(([label, value]) => `<span><i></i>${escapeHtml(label)}<b>${total ? Math.round((value.taxable / total) * 100) : 0}%</b><small><strong>Imponibile ${money(value.taxable)}</strong><br>Totale lordo ${money(value.gross)}</small></span>`).join('') : '<div class="dashboard-empty">Nessuna area disponibile.</div>'}</div>`;
}

const dashboardSalesExpanded = { products: false, promotions: false };

function renderExpandableSales(kind, rows, formatter) {
  const limited = currentUser?.role === 'admin';
  const expanded = limited && dashboardSalesExpanded[kind];
  byId(`admin-${kind}-chart`).innerHTML = dashboardBarRows(limited && !expanded ? rows.slice(0, 10) : rows, formatter);
  const button = byId(`admin-${kind}-expand`);
  button.hidden = !limited || rows.length <= 10;
  button.textContent = expanded ? 'Mostra meno' : `Mostra tutti (${rows.length})`;
  button.ariaExpanded = String(Boolean(expanded));
}

function renderAdminDashboard() {
  if (!['admin', 'agent', 'distributor'].includes(currentUser?.role) || !byId('admin-dashboard')) return;
  renderDashboardProfilePicker();
  const orders = dashboardFilteredOrders();
  const total = orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
  const customerKeys = new Set(orders.map((order) => String(order.customerEmail || order.customer).toLowerCase()).filter(Boolean));
  const validHistoricalOrders = dashboardScopedOrders().filter((order) => !['cancelled', 'failed', 'refunded', 'trash'].includes(String(order.status).toLowerCase()));
  const { start, end } = dashboardDateRange();
  const historicalCustomerGroups = dashboardCustomerGroups(validHistoricalOrders);
  const newCustomerOrders = [...historicalCustomerGroups.values()].filter((customer) => customer.orders.length === 1).map((customer) => customer.orders[0]).filter((order) => {
    const orderDate = dashboardDateValue(order.date);
    return (!start || orderDate >= start) && (!end || orderDate <= end);
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const orderCountByCustomer = new Map();
  orders.forEach((order) => {
    const key = String(order.customerEmail || order.customer).toLowerCase();
    if (key) orderCountByCustomer.set(key, (orderCountByCustomer.get(key) || 0) + 1);
  });
  const repeatCustomers = [...orderCountByCustomer.values()].filter((count) => count > 1).length;
  const pendingOrders = orders.filter((order) => ['pending', 'on-hold'].includes(String(order.status).toLowerCase()));
  const workingOrders = orders.filter((order) => ['processing'].includes(String(order.status).toLowerCase()));
  const summarizeOrders = (rows) => ({ pieces: rows.reduce((sum, order) => sum + dashboardOrderPieces(order), 0), amount: rows.reduce((sum, order) => sum + Number(order.amount || 0), 0), taxable: rows.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0) });
  const pendingSummary = summarizeOrders(pendingOrders);
  const workingSummary = summarizeOrders(workingOrders);
  const distributorRevenue = orders.filter((order) => !order.agent && order.distributor).reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const agentRevenue = orders.filter((order) => order.agent).reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const totalTaxable = orders.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0);
  const distributorTaxable = orders.filter((order) => !order.agent && order.distributor).reduce((sum, order) => sum + dashboardOrderTaxable(order), 0);
  const agentTaxable = orders.filter((order) => order.agent).reduce((sum, order) => sum + dashboardOrderTaxable(order), 0);
  byId('admin-kpi-revenue').textContent = money(totalTaxable);
  byId('admin-kpi-revenue-taxable').textContent = `Totale lordo ${money(total)}`;
  byId('admin-kpi-pending').textContent = pendingOrders.length.toLocaleString('it-IT');
  byId('admin-kpi-pending-detail').innerHTML = `<b>Imponibile ${money(pendingSummary.taxable)}</b><br>Totale lordo ${money(pendingSummary.amount)} · ${pendingSummary.pieces} pezzi`;
  byId('admin-kpi-working').textContent = workingOrders.length.toLocaleString('it-IT');
  byId('admin-kpi-working-detail').innerHTML = `<b>Imponibile ${money(workingSummary.taxable)}</b><br>Totale lordo ${money(workingSummary.amount)} · ${workingSummary.pieces} pezzi`;
  byId('admin-kpi-distributor-revenue').textContent = money(distributorTaxable);
  byId('admin-kpi-agent-revenue').textContent = money(agentTaxable);
  byId('admin-kpi-distributor-taxable').textContent = `Totale lordo ${money(distributorRevenue)}`;
  byId('admin-kpi-agent-taxable').textContent = `Totale lordo ${money(agentRevenue)}`;
  byId('admin-kpi-new-customer-count').textContent = customerKeys.size.toLocaleString('it-IT');
  byId('admin-kpi-customers').textContent = 'clienti nel periodo selezionato';
  byId('admin-kpi-repeat-customers').textContent = repeatCustomers.toLocaleString('it-IT');
  byId('admin-new-customers-total').textContent = newCustomerOrders.length.toLocaleString('it-IT');
  byId('admin-sales-total').textContent = money(totalTaxable);
  byId('admin-sales-gross').textContent = `Totale lordo ${money(total)}`;
  renderAdminSalesChart(orders);
  renderItalyChart(orders);

  const products = new Map(); const categories = new Map(); const channels = new Map(); const promotionSales = new Map();
  orders.forEach((order) => {
    const channel = order.agent ? `Agente · ${order.agent}` : order.distributor ? `Distributore · ${order.distributor}` : 'Non associato alla rete';
    const channelValue = channels.get(channel) || { value: 0, gross: 0 };
    channelValue.value += dashboardOrderTaxable(order);
    channelValue.gross += Number(order.amount) || 0;
    channels.set(channel, channelValue);
    (order.items || []).forEach((item) => {
      const product = shopProducts.find((entry) => Number(entry.id) === Number(item.productId)) || shopProducts.find((entry) => entry.name === item.name);
      const category = product?.categories?.find((entry) => !/promo/i.test(`${entry.slug} ${entry.name}`))?.name || 'Altri';
      addDashboardProductSale(categories, category, item);
      const isPromotion = /promo|pacchett/i.test(item.name) || product?.categories?.some((entry) => /promo|pacchett/i.test(`${entry.slug} ${entry.name}`));
      if (isPromotion) addDashboardProductSale(promotionSales, item.name, item);
      else addDashboardProductSale(products, item.name, item);
    });
  });
  const topRows = (map, limit = 5) => [...map.entries()].map(([label, value]) => ({ label, ...value })).sort((a, b) => b.value - a.value).slice(0, limit);
  const pieceRows = map => [...map.entries()].map(([label, sale]) => ({label, value: sale.quantity})).sort((a,b) => b.value - a.value);
  const piecesLabel = value => `${value.toLocaleString('it-IT')} pz`;
  renderExpandableSales('products', pieceRows(products), piecesLabel);
  byId('admin-category-chart').innerHTML = dashboardBarRows(pieceRows(categories), piecesLabel);
  renderExpandableSales('promotions', pieceRows(promotionSales), piecesLabel);
  const channelRows = topRows(channels, Infinity);
  const agentRows = channelRows.filter(row => row.label.startsWith('Agente · ')).map(row => ({...row, label: row.label.slice(9)}));
  const distributorRows = channelRows.filter(row => row.label.startsWith('Distributore · ')).map(row => ({...row, label: row.label.slice(15)}));
  byId('admin-agents-chart').innerHTML = dashboardBarRows(agentRows);
  byId('admin-distributors-chart').innerHTML = dashboardBarRows(distributorRows);
  byId('admin-channel-agents-total').textContent = money(agentRows.reduce((sum, row) => sum + row.value, 0));
  byId('admin-channel-distributors-total').textContent = money(distributorRows.reduce((sum, row) => sum + row.value, 0));
  const unassignedRows = channelRows.filter(row => row.label === 'Non associato alla rete');
  byId('admin-channel-unassigned').innerHTML = unassignedRows.length ? dashboardBarRows(unassignedRows) : '';
  const customerView = currentUser.role !== 'admin' || Boolean(dashboardProfileId);
  byId('dashboard-channel-label').textContent = customerView ? 'Clienti · imponibile' : 'Canali · imponibile';
  byId('dashboard-channel-title').textContent = customerView ? 'I miei clienti' : 'Agenti e distributori';
  byId('dashboard-network-channels').hidden = customerView;
  byId('admin-channel-unassigned').hidden = customerView;
  byId('dashboard-customer-channels').hidden = !customerView;
  const customerRows = customerView ? [...dashboardCustomerGroups(orders).values()].map(customer => ({
    label: customer.email ? `${customer.customer} · ${customer.email}` : customer.customer,
    value: customer.orders.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0),
    gross: customer.orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0),
  })).sort((a,b) => b.value - a.value) : [];
  byId('dashboard-customer-channels').innerHTML = customerView ? dashboardBarRows(customerRows) : '';
  const channelTotal = [...channels.values()].reduce((sum, value) => sum + value.value, 0);
  byId('admin-channel-total').textContent = `Imponibile ${customerView ? 'clienti' : 'canali'} ${money(channelTotal)} · ${Math.abs(channelTotal - totalTaxable) < 0.01 ? 'corrisponde all’imponibile totale' : 'da verificare'}`;
}

function dashboardCustomerKey(order) {
  return String(order.customerEmail || order.customer || '').trim().toLowerCase();
}

function dashboardCustomerGroups(orders) {
  const groups = new Map();
  orders.forEach((order) => {
    const key = dashboardCustomerKey(order);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, customer: order.customer || '-', email: order.customerEmail || '', orders: [] });
    groups.get(key).orders.push(order);
  });
  return groups;
}

function dashboardOrderDetailRows(orders) {
  return orders.map((order) => `<tr>
    <td><strong>${escapeHtml(order.id)}</strong></td>
    <td>${escapeHtml(order.date || '-')}</td>
    <td><strong>${escapeHtml(order.customer || '-')}</strong>${order.customerEmail ? `<br><small>${escapeHtml(order.customerEmail)}</small>` : ''}</td>
    <td>${dashboardOrderPieces(order).toLocaleString('it-IT')}</td>
    <td><strong>${money(dashboardOrderTaxable(order))}</strong></td>
    <td><small>${money(order.amount)}</small></td>
    <td>${money(order.taxAmount)}</td>
    <td>${money(order.shippingAmount)}</td>
    <td><span class="state ${orderStatusClass(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span></td>
    <td>${escapeHtml(order.agent || order.distributor || order.center || '-')}</td>
  </tr>`).join('');
}

function dashboardOrderOrigin(order) {
  if (order.agent) return { label: `Agente · ${order.agent}`, direct: false };
  if (order.distributor) return { label: `Distributore · ${order.distributor}`, direct: false };
  if (order.center) return { label: `Centro · ${order.center}`, direct: false };
  return { label: 'Acquisto diretto', direct: true };
}

function openDashboardDetail(type) {
  if (!['admin', 'agent', 'distributor'].includes(currentUser?.role)) return;
  const orders = dashboardFilteredOrders();
  const periodLabel = byId('admin-dashboard-period')?.selectedOptions?.[0]?.textContent || 'Periodo selezionato';
  let title = ''; let summary = ''; let headers = ''; let rows = '';
  if (['category-sales', 'promotion-sales', 'product-sales', 'channel-sales'].includes(type)) {
    const breakdown = new Map();
    if (type === 'channel-sales' && (currentUser.role !== 'admin' || Boolean(dashboardProfileId))) {
      const customers = [...dashboardCustomerGroups(orders).values()].map(customer => ({...customer,
        taxable: customer.orders.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0),
        gross: customer.orders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0),
      })).sort((a,b) => b.taxable - a.taxable);
      title = 'I miei clienti';
      headers = '<tr><th>Cliente</th><th>Ordini</th><th>Imponibile prodotti</th><th>Totale lordo</th></tr>';
      rows = customers.map(customer => `<tr><td><strong>${escapeHtml(customer.customer)}</strong>${customer.email ? `<br><small>${escapeHtml(customer.email)}</small>` : ''}</td><td>${customer.orders.length}</td><td><strong>${money(customer.taxable)}</strong></td><td><small>${money(customer.gross)}</small></td></tr>`).join('');
      summary = `${periodLabel} · ${customers.length} clienti · Imponibile ${money(customers.reduce((sum, customer) => sum + customer.taxable, 0))} · Totale lordo ${money(customers.reduce((sum, customer) => sum + customer.gross, 0))}`;
    } else if (type === 'channel-sales') {
      orders.forEach((order) => {
        const label = order.agent ? `Agente · ${order.agent}` : order.distributor ? `Distributore · ${order.distributor}` : order.center ? `Centro · ${order.center}` : 'Acquisto diretto / non associato';
        const current = breakdown.get(label) || { quantity: 0, amount: 0, taxable: 0 };
        current.quantity += 1;
        current.amount += Number(order.amount || 0);
        current.taxable += dashboardOrderTaxable(order);
        breakdown.set(label, current);
      });
      title = 'Agenti e distributori';
      headers = '<tr><th>Canale</th><th>Ordini</th><th>Imponibile prodotti</th><th>Totale lordo</th></tr>';
      rows = [...breakdown.entries()].sort((a, b) => b[1].taxable - a[1].taxable).map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${value.quantity}</td><td><strong>${money(value.taxable)}</strong></td><td><small>${money(value.amount)}</small></td></tr>`).join('');
      summary = `${periodLabel} · ${breakdown.size} canali · Imponibile ${money([...breakdown.values()].reduce((sum, value) => sum + value.taxable, 0))} · Totale lordo ${money([...breakdown.values()].reduce((sum, value) => sum + value.amount, 0))}`;
    } else {
      orders.forEach((order) => (order.items || []).forEach((item) => {
          const product = shopProducts.find((entry) => Number(entry.id) === Number(item.productId)) || shopProducts.find((entry) => entry.name === item.name);
        const isPromotion = /promo|pacchett/i.test(item.name) || product?.categories?.some((entry) => /promo|pacchett/i.test(`${entry.slug} ${entry.name}`));
        let label = item.name;
        if (type === 'category-sales') label = product?.categories?.find((entry) => !/promo/i.test(`${entry.slug} ${entry.name}`))?.name || 'Altri';
        if (type === 'promotion-sales' && !isPromotion) return;
        if (type === 'product-sales' && isPromotion) return;
        addDashboardProductSale(breakdown, label, item);
      }));
      title = type === 'category-sales' ? 'Vendite per categoria' : type === 'promotion-sales' ? 'Vendite promozionali' : 'Vendite per prodotto';
      headers = `<tr><th>${type === 'category-sales' ? 'Categoria' : type === 'promotion-sales' ? 'Promozione' : 'Prodotto'}</th><th>Pezzi venduti</th></tr>`;
      rows = [...breakdown.entries()].sort((a, b) => b[1].quantity - a[1].quantity).map(([label, sale]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td><strong>${sale.quantity.toLocaleString('it-IT')}</strong></td></tr>`).join('');
      summary = `${periodLabel} · ${breakdown.size} voci · ${[...breakdown.values()].reduce((sum, value) => sum + value.quantity, 0).toLocaleString('it-IT')} pezzi venduti`;
    }
  } else if (['pending', 'working', 'total-revenue', 'distributor-revenue', 'agent-revenue'].includes(type)) {
    const detailOrders = type === 'pending'
      ? orders.filter((order) => ['pending', 'on-hold'].includes(String(order.status).toLowerCase()))
      : type === 'working'
        ? orders.filter((order) => String(order.status).toLowerCase() === 'processing')
        : type === 'distributor-revenue'
          ? orders.filter((order) => !order.agent && order.distributor)
          : type === 'agent-revenue'
            ? orders.filter((order) => order.agent)
            : orders;
    const pieces = detailOrders.reduce((sum, order) => sum + dashboardOrderPieces(order), 0);
    const amount = detailOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
    const taxable = detailOrders.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0);
    title = type === 'pending' ? 'Ordini in attesa'
      : type === 'working' ? 'Ordini in lavorazione'
        : type === 'distributor-revenue' ? 'Fatturato distributori'
          : type === 'agent-revenue' ? 'Fatturato agenti'
            : 'Totale fatturato';
    summary = `${periodLabel} · ${detailOrders.length} ordini · ${pieces} pezzi · Imponibile ${money(taxable)} · Totale lordo ${money(amount)}`;
    headers = '<tr><th>Ordine</th><th>Data</th><th>Cliente</th><th>Pezzi</th><th>Imponibile prodotti</th><th>Totale lordo</th><th>IVA</th><th>Trasporto</th><th>Stato</th><th>Canale</th></tr>';
    rows = dashboardOrderDetailRows(detailOrders);
  } else if (type === 'new-customers') {
    const { start, end } = dashboardDateRange();
    const historicalOrders = dashboardScopedOrders().filter((order) => !['cancelled', 'failed', 'refunded', 'trash'].includes(String(order.status).toLowerCase()));
    const customers = [...dashboardCustomerGroups(historicalOrders).values()].filter((customer) => customer.orders.length === 1).filter((customer) => {
      const orderDate = dashboardDateValue(customer.orders[0].date);
      return (!start || orderDate >= start) && (!end || orderDate <= end);
    }).sort((a, b) => String(b.orders[0].date).localeCompare(String(a.orders[0].date)));
    title = 'Nuovi clienti';
    summary = `${periodLabel} · ${customers.length} clienti con un solo acquisto complessivo`;
    headers = '<tr><th>Cliente</th><th>Ordine</th><th>Imponibile prodotti</th><th>Totale lordo</th><th>Pezzi</th><th>Provenienza</th></tr>';
    rows = customers.map((customer) => {
      const order = customer.orders[0];
      const origin = dashboardOrderOrigin(order);
      return `<tr><td><strong>${escapeHtml(customer.customer)}</strong>${customer.email ? `<br><small>${escapeHtml(customer.email)}</small>` : ''}</td><td>${escapeHtml(order.date || '-')}<br><small>${escapeHtml(order.id || '')}</small></td><td><strong>${money(dashboardOrderTaxable(order))}</strong></td><td><small>${money(order.amount)}</small></td><td>${dashboardOrderPieces(order)}</td><td><span class="dashboard-origin ${origin.direct ? 'direct' : ''}">${escapeHtml(origin.label)}</span></td></tr>`;
    }).join('');
  } else {
    const periodGroups = dashboardCustomerGroups(orders);
    let customers = [...periodGroups.values()];
    if (type === 'customers') {
      title = 'Clienti';
    } else {
      title = 'Clienti con riordino';
      customers = customers.filter((customer) => customer.orders.length > 1);
    }
    customers.sort((a, b) => Math.max(...b.orders.map((order) => new Date(order.date).getTime())) - Math.max(...a.orders.map((order) => new Date(order.date).getTime())));
    summary = `${periodLabel} · ${customers.length} clienti`;
    headers = '<tr><th>Cliente</th><th>Primo ordine</th><th>Ultimo ordine</th><th>Ordini</th><th>Pezzi</th><th>Imponibile acquistato</th><th>Totale lordo</th></tr>';
    rows = customers.map((customer) => {
      const sorted = [...customer.orders].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const pieces = sorted.reduce((sum, order) => sum + dashboardOrderPieces(order), 0);
      const amount = sorted.reduce((sum, order) => sum + Number(order.amount || 0), 0);
      return `<tr><td><strong>${escapeHtml(customer.customer)}</strong>${customer.email ? `<br><small>${escapeHtml(customer.email)}</small>` : ''}</td><td>${escapeHtml(sorted[0]?.date || '-')}<br><small>${escapeHtml(sorted[0]?.id || '')}</small></td><td>${escapeHtml(sorted.at(-1)?.date || '-')}<br><small>${escapeHtml(sorted.at(-1)?.id || '')}</small></td><td>${sorted.length}</td><td>${pieces}</td><td><strong>${money(sorted.reduce((sum, order) => sum + dashboardOrderTaxable(order), 0))}</strong></td><td><small>${money(amount)}</small></td></tr>`;
    }).join('');
  }
  byId('dashboard-detail-content').innerHTML = `<div class="dashboard-detail-head"><h2 id="dashboard-detail-title">${escapeHtml(title)}</h2><button class="product-detail-close" type="button" data-dashboard-detail-close aria-label="Chiudi">×</button></di…27351 tokens truncated…' : 'Codice errato');
    return result.valid === true;
  } catch {
    if (byId('register-code').value.trim() === code && byId('register-role').value === 'patient') {
      setRegistrationCodeError('Verifica codice non disponibile. Riprova.');
    }
    return false;
  }
}

async function submitRegistration(event) {
  event.preventDefault();
  if (authBusy || !supabase) return;
  if (!byId('register-privacy').checked) {
    showAuthMessage('Per creare il profilo serve accettare la privacy.', 'error');
    return;
  }

  const requestedRole = byId('register-role').value;
  const code = byId('register-code').value.trim();
  if (requestedRole === 'patient' && !code) {
    const input = byId('register-code');
    input.setCustomValidity('Inserisci il codice ENTE.');
    input.reportValidity();
    input.focus();
    showAuthMessage('Il codice ENTE è obbligatorio per il profilo Cliente.', 'error');
    return;
  }

  const email = byId('register-email').value.trim();
  const fullName = `${byId('register-name').value.trim()} ${byId('register-surname').value.trim()}`.trim();
  setRegistrationCodeError('');
  setAuthBusy(true);
  if (requestedRole === 'patient' && !(await checkRegistrationCode())) {
    setAuthBusy(false);
    byId('register-code').focus();
    return;
  }
  showAuthMessage('Creazione del profilo in corso...');

  const { data, error } = await supabase.auth.signUp({
    email,
    password: byId('register-password').value,
    options: {
      data: {
        full_name: fullName,
        phone: byId('register-phone').value.trim(),
        requested_role: requestedRole,
        validation_code: code,
      },
    },
  }).catch(() => ({ data: null, error: { message: 'Connessione non riuscita. Riprova tra poco.' } }));

  if (error) {
    const invalidCode = requestedRole === 'patient' && /database error|unexpected_failure|codice ENTE/i.test(`${error.message || ''} ${error.code || ''}`);
    const message = invalidCode
      ? 'Codice errato'
      : error.message || 'Non è stato possibile creare il profilo.';
    if (invalidCode) setRegistrationCodeError('Codice errato');
    showAuthMessage(message, 'error');
    setAuthBusy(false);
    return;
  }

  if (!data.session) {
    setAuthMode('login');
    byId('login-email').value = email;
    showAuthMessage(
      `Profilo creato per ${email}. Se hai richiesto un profilo professionale, dovrà essere approvato dall’amministratore prima dell’accesso.`,
      'success',
    );
    setAuthBusy(false);
    return;
  }

  try {
    await enterAuthenticatedApp(data.user);
  } catch {
    showAuthMessage('Profilo creato, ma la scheda ODR non è ancora disponibile.', 'error');
  } finally {
    setAuthBusy(false);
  }
}

function passwordRecoveryErrorMessage(error) {
  if (error?.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code)) {
    return 'Hai richiesto più link in poco tempo. Attendi qualche minuto e usa solo l’ultima email ricevuta.';
  }
  if (error?.code === 'same_password') return 'Scegli una password diversa da quella attuale.';
  if (error?.code === 'weak_password') return 'La password non soddisfa i requisiti di sicurezza. Scegline una più lunga e meno comune.';
  if (['session_not_found', 'refresh_token_not_found', 'otp_expired'].includes(error?.code)) return 'Il link è scaduto o è già stato usato. Richiedi un nuovo link di recupero.';
  return 'Operazione non riuscita. Controlla la connessione e riprova; se il problema continua, contatta l’amministratore.';
}

async function submitPasswordRecovery(event) {
  event.preventDefault();
  if (authBusy || !supabase) return;
  const email = byId('recovery-email').value.trim();
  setAuthBusy(true);
  showAuthMessage('Invio del link in corso...');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/recupera-password`,
    });
    if (error) { showAuthMessage(passwordRecoveryErrorMessage(error), 'error'); return; }
    showAuthMessage('Se l’indirizzo è associato a un account ODR, riceverai un’email. Controlla anche lo spam e apri solo il link dell’ultima email per scegliere e salvare la nuova password.', 'success');
  } catch {
    showAuthMessage('Connessione non disponibile. Riprova tra poco.', 'error');
  } finally {
    setAuthBusy(false);
  }
}

async function submitPasswordReset(event) {
  event.preventDefault();
  if (authBusy || !supabase) return;

  const password = byId('reset-password').value;
  const confirmation = byId('reset-password-confirm').value;
  if (password.length < 8) {
    showAuthMessage('La nuova password deve contenere almeno 8 caratteri.', 'error');
    return;
  }
  if (password !== confirmation) {
    showAuthMessage('Le due password non coincidono.', 'error');
    return;
  }

  setAuthBusy(true);
  showAuthMessage('Aggiornamento della password in corso...');
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      showAuthMessage('Sessione di recupero assente o scaduta. Premi “Richiedi un nuovo link”.', 'error');
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { showAuthMessage(passwordRecoveryErrorMessage(error), 'error'); return; }
    await supabase.auth.signOut();
    passwordRecoveryActive = false;
    window.history.replaceState({}, '', '/');
    setAuthMode('login');
    byId('password-reset-form').reset();
    showAuthMessage('Password aggiornata. Ora accedi con la nuova password dell’app ODR.', 'success');
  } catch {
    showAuthMessage('Non è stato possibile completare la richiesta. Controlla la connessione e riprova.', 'error');
  } finally {
    setAuthBusy(false);
  }
}

async function submitLogout() {
  if (!supabase) return;
  await supabase.auth.signOut();
  disposeStoreLocator?.(); disposeStoreLocator = null;
  currentUser = null;
  adminCustomerReport = null;
  byId('customer-report-table').innerHTML = '';
  byId('dashboard-detail-dialog').close();
  byId('dashboard-detail-content').innerHTML = '';
  validatedCode = null;
  shopAddressLoaded = false;
  byId('app-shell').classList.add('hidden');
  byId('auth-screen').classList.remove('hidden');
  byId('login-password').value = '';
  showAuthMessage('Sessione terminata correttamente.', 'success');
}

function parseCsv(text) {
  const separator = text.includes('\t') ? '\t' : ';';
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(separator).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(separator).map((cell) => cell.trim());
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || '']));
    const rawType = String(row.tipo || row.type || '').toLowerCase();
    const type = rawType.includes('agent') ? 'agent' : rawType.includes('cent') ? 'center' : 'distributor';
    const name = row.nome || row.name || row.ragione_sociale || '';
    return {
      id: `import-${Date.now()}-${index}`,
      type,
      name,
      email: row.email || '',
      phone: row.telefono || row.phone || '',
      area: row.zona || row.area || '',
      parentName: row.distributore || row.agente || row.parent || '',
      active: Boolean(name),
    };
  }).filter((row) => row.name);
}

function parseOrderCsv(text) {
  const separator = text.includes('\t') ? '\t' : ';';
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(separator).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(separator).map((cell) => cell.trim());
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || '']));
    return {
      id: row.ordine || row.order || row.id || `WC-IMPORT-${Date.now()}-${index}`,
      date: row.data || row.date || new Date().toISOString().slice(0, 10),
      customer: row.cliente || row.customer || row.nome || 'Cliente WooCommerce',
      amount: Number(String(row.importo || row.totale || row.amount || '0').replace(',', '.')) || 0,
      taxAmount: Number(String(row.iva || '0').replace(',', '.')) || 0,
      shippingNetAmount: Number(String(row.trasporto_netto || '0').replace(',', '.')) || 0,
      coupon: row.coupon || row.codice || '',
      agent: row.agente || '',
      distributor: row.distributore || '',
      status: row.stato || row.status || 'completed',
    };
  });
}

function importNetworkFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const rows = parseCsv(String(reader.result || ''));
    byId('import-notice').textContent = `Importazione di ${rows.length} righe...`;
    const { data, error } = await supabase.functions.invoke('network-management', {
      method: 'POST',
      body: { action: 'import', rows, fileName: file.name },
    });
    if (error || data?.error) {
      byId('import-notice').textContent = data?.error || 'Importazione non riuscita.';
      return;
    }
    await loadNetwork();
    byId('import-notice').textContent = `${data.imported} righe importate e salvate da ${file.name}.`;
  };
  reader.readAsText(file);
}

function importOrdersFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseOrderCsv(String(reader.result || ''));
    reportOrders = [...rows, ...reportOrders];
    renderOrders();
    updateMetrics();
  };
  reader.readAsText(file);
}

function exportReport() {
  const header = ['ordine', 'data', 'cliente', 'email', 'coupon', 'agente', 'distributore', 'centro', 'imponibile', 'importo', 'iva', 'trasporto_netto', 'stato'];
  const lines = filteredReportOrders.map((order) => [
    order.id,
    order.date,
    order.customer,
    order.customerEmail || '',
    order.coupon || '',
    order.agent || '',
    order.distributor || '',
    order.center || '',
    dashboardOrderTaxable(order).toFixed(2),
    Number(order.amount || 0).toFixed(2),
    Number(order.taxAmount || 0).toFixed(2),
    Number(order.shippingNetAmount || 0).toFixed(2),
    order.status,
  ]);
  const csv = [header, ...lines].map((row) => row.join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'odr-report-vendite.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function initSupabaseStatus() {
  byId('supabase-dot').className = isSupabaseConfigured ? 'dot ok' : 'dot warn';
  byId('supabase-status').textContent = isSupabaseConfigured ? 'Supabase collegato' : 'Configurazione mancante';
  byId('supabase-pill').className = isSupabaseConfigured ? 'config-pill ok' : 'config-pill warn';
  byId('supabase-pill').textContent = isSupabaseConfigured ? 'Connessione attiva' : 'Connessione non disponibile';
  if (!isSupabaseConfigured) {
    showAuthMessage('Configurazione Supabase non disponibile in questo ambiente.', 'error');
  }
}

async function restoreSession() {
  if (!supabase) return;
  try {
    const initialized = await supabase.auth.initialize();
    const { data, error } = await supabase.auth.getSession();
    if (passwordRecoveryActive) {
      if (initialized.error || error || !data.session?.user) {
        passwordRecoveryActive = false;
        window.history.replaceState({}, '', '/recupera-password');
        setAuthMode('recovery');
        showAuthMessage('Il link di recupero manca, è scaduto o è già stato usato. Inserisci la tua email per riceverne uno nuovo.', 'error');
        return;
      }
      setAuthMode('reset');
      showAuthMessage('Link verificato. Scegli e salva una nuova password per l’app ODR.', 'success');
      return;
    }
    if (!data.session?.user) return;
    await enterAuthenticatedApp(data.session.user);
  } catch {
    setAuthMode(passwordRecoveryActive ? 'recovery' : 'login');
    showAuthMessage('Impossibile verificare la sessione. Controlla la connessione e riprova.', 'error');
  }
}

let adminCustomerReport = null;
let adminCustomerReportLoading = false;

// Stable customer IDs take precedence; email merges only unambiguous records across sources.
function buildCustomerReport(masters, orders) {
  const groups = new Map(masters.map(c => [c.id, { ...c, orders: [], aliases: [c.id] }]));
  const emailKey = value => String(value || '').trim().toLowerCase();
  const emails = new Map();
  for (const group of groups.values()) {
    const email = emailKey(group.email);
    if (email) emails.set(email, [...(emails.get(email) || []), group]);
  }
  for (const candidates of emails.values()) {
    if (candidates.length === 2 && candidates[0].id.startsWith('app-') !== candidates[1].id.startsWith('app-')) {
      const [target, other] = candidates;
      target.aliases.push(other.id);
      for (const [key, value] of Object.entries(other)) if (!target[key] && value) target[key] = value;
      groups.set(other.id, target);
    }
  }
  const seenOrders = new Set();
  for (const order of orders) {
    if (seenOrders.has(order.id)) continue;
    seenOrders.add(order.id);
    const reference = String(order.customerReference || '');
    const id = reference || (order.customerId ? `wc-${order.customerId}` : '');
    let group = groups.get(id);
    const email = emailKey(order.customerEmail);
    const matches = [...new Set((emails.get(email) || []).map(c => groups.get(c.id)))];
    if (!group && matches.length === 1 && (!id || matches[0].aliases.includes(id))) group = matches[0];
    if (!group) {
      const key = id || (matches.length === 0 && email ? `guest-${email}` : `order-${order.id}`);
      group = groups.get(key);
      if (!group) {
        const b = order.customerBilling || {};
        group = { id: key, aliases: [key], name: order.customer, email: order.customerEmail, company: b.company || '', phone: b.phone || '',
          address: [b.address_1,b.address_2,b.postcode,b.city,b.state,b.country].filter(Boolean).join(', '), orders: [] };
        groups.set(key, group);
      }
    }
    group.orders.push(order);
  }
  return [...new Set(groups.values())];
}

function customerPeriodOrders(orders, from, to) {
  return orders.filter(o => !['cancelled','failed','refunded','trash'].includes(o.status)
    && (!from || o.date >= from) && (!to || o.date <= to));
}

function customerMonthlySeries(orders, from, to) {
  const dates = orders.map(o => o.date).filter(Boolean).sort();
  const start = (from || dates[0] || to || '').slice(0,7);
  const end = (to || dates.at(-1) || from || '').slice(0,7);
  if (!start || !end || start > end) return [];
  const totals = new Map();
  for (const o of orders) {
    const key = o.date.slice(0,7);
    totals.set(key, (totals.get(key) || 0) + Math.round(dashboardOrderTaxable(o) * 100));
  }
  const series = [];
  let [year, month] = start.split('-').map(Number);
  while (`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}` <= end) {
    const key = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;
    series.push({ label: key, value: (totals.get(key) || 0) / 100 });
    month++; if (month === 13) { month = 1; year++; }
  }
  return series;
}

async function loadAdminCustomerReport(force = false) {
  if (currentUser?.role !== 'admin' || adminCustomerReportLoading) return;
  if (!force && adminCustomerReport?.userId === currentUser.id) { renderAdminCustomerReport(); return; }
  const userId = currentUser.id;
  adminCustomerReportLoading = true;
  adminCustomerReport = null;
  byId('customer-report-table').innerHTML = '';
  byId('customer-report-summary').textContent = '';
  byId('customer-report-message').textContent = 'Caricamento anagrafica e ordini…';
  byId('customer-report-refresh').disabled = true;
  try {
    const { data } = await supabase.auth.getSession();
    const headers = { Authorization: `Bearer ${data.session?.access_token || ''}` };
    const [customerResponse, orderResponse] = await Promise.all([
      fetch('/api/admin-customers', { headers }), fetch('/api/orders', { headers }),
    ]);
    const [customers, orders] = await Promise.all([customerResponse.json(), orderResponse.json()]);
    if (!customerResponse.ok || !orderResponse.ok) throw new Error(customers.error || orders.error || 'Dati non disponibili. Riprova.');
    if (currentUser?.role !== 'admin' || currentUser.id !== userId) return;
    adminCustomerReport = { userId, groups: buildCustomerReport(customers.customers || [], orders.orders || []), warnings: orders.warnings || [] };
    renderAdminCustomerReport();
  } catch (error) {
    if (currentUser?.id === userId) byId('customer-report-message').textContent = error.message || 'Caricamento non riuscito. Riprova.';
  } finally {
    adminCustomerReportLoading = false;
    byId('customer-report-refresh').disabled = false;
  }
}

function renderAdminCustomerReport() {
  if (currentUser?.role !== 'admin' || !adminCustomerReport || adminCustomerReport.userId !== currentUser.id) return;
  const from = byId('customer-report-from').value;
  const to = byId('customer-report-to').value;
  byId('customer-report-table').innerHTML = '';
  byId('customer-report-summary').textContent = '';
  if (from && to && from > to) { byId('customer-report-message').textContent = 'La data iniziale deve precedere quella finale.'; return; }
  const query = byId('customer-report-search').value.trim().toLowerCase();
  const rows = adminCustomerReport.groups.map((c,index) => {
    const orders = customerPeriodOrders(c.orders, from, to);
    return { c, index, orders, cents: orders.reduce((sum,o) => sum + Math.round(dashboardOrderTaxable(o)*100),0) };
  }).filter(({c}) => [c.name,c.company,c.email,c.phone].some(v => String(v || '').toLowerCase().includes(query)))
    .sort((a,b) => b.cents-a.cents || String(a.c.name).localeCompare(String(b.c.name),'it'));
  byId('customer-report-message').textContent = `${rows.length} clienti · ${from || 'Inizio storico'} — ${to || 'Ultimo ordine'}. Ordini annullati, falliti e rimborsati esclusi. ${adminCustomerReport.warnings.join(' ')}`;
  byId('customer-report-summary').textContent = `Imponibile ${money(rows.reduce((sum,r) => sum+r.cents,0)/100)} · ${rows.reduce((sum,r) => sum+r.orders.length,0)} ordini`;
  byId('customer-report-table').innerHTML = rows.map(({c,index,orders,cents}) => {
    const owners = [...new Set(orders.map(o => o.agent || o.distributor).filter(Boolean))];
    const details = [c.company,c.email,c.phone,c.address,c.vatNumber && `P. IVA ${c.vatNumber}`,c.taxCode && `Codice fiscale ${c.taxCode}`,c.pec && `PEC ${c.pec}`,c.sdiCode && `SDI ${c.sdiCode}`].filter(Boolean);
    return `<tr><td><strong>${escapeHtml(c.name || c.email || 'Cliente')}</strong>${details.map(v=>`<small>${escapeHtml(v)}</small>`).join('')}</td><td>${escapeHtml(owners.join(', ') || '—')}</td><td>${orders.length}</td><td><button class="secondary customer-turnover" type="button" data-customer-turnover="${index}" aria-label="Andamento acquisti di ${escapeHtml(c.name || c.email || 'Cliente')}">${money(cents/100)}</button><small>Lordo ${money(orders.reduce((sum,o)=>sum+Number(o.amount || 0),0))}</small></td></tr>`;
  }).join('') || '<tr><td colspan="4">Nessun cliente trovato.</td></tr>';
}

function openCustomerTurnover(index) {
  if (currentUser?.role !== 'admin' || !adminCustomerReport || adminCustomerReport.userId !== currentUser.id) return;
  const customer = adminCustomerReport.groups[index];
  if (!customer) return;
  const from = byId('customer-report-from').value, to = byId('customer-report-to').value;
  if (from && to && from > to) return;
  const orders = customerPeriodOrders(customer.orders,from,to).sort((a,b)=>b.date.localeCompare(a.date));
  const series = customerMonthlySeries(orders,from,to);
  const maximum = Math.max(...series.map(row => row.value), 1);
  const chart = series.length ? series.map(row => `<div class="dashboard-bar-row"><div><span>${escapeHtml(row.label)}</span><strong>${money(row.value)}</strong></div><div class="dashboard-bar-track"><i style="width:${row.value / maximum * 100}%"></i></div></div>`).join('') : '<p>Nessun acquisto nel periodo.</p>';
  byId('dashboard-detail-content').innerHTML = `<div class="dashboard-detail-head"><h2 id="dashboard-detail-title">Acquisti · ${escapeHtml(customer.name || customer.email || 'Cliente')}</h2><button class="product-detail-close" type="button" data-dashboard-detail-close aria-label="Chiudi">×</button></div><div class="dashboard-detail-body"><p>${escapeHtml(from || 'Inizio storico')} — ${escapeHtml(to || 'Ultimo ordine')} · ${orders.length} ordini · Imponibile ${money(orders.reduce((sum,o)=>sum+Math.round(dashboardOrderTaxable(o)*100),0)/100)}</p><h3>Andamento mensile · imponibile</h3><div class="dashboard-bars customer-monthly-chart">${chart}</div><h3>Ordini del periodo</h3><div class="dashboard-detail-table-wrap"><table class="dashboard-detail-table"><thead><tr><th>Ordine</th><th>Data</th><th>Imponibile</th><th>Totale lordo</th><th>Stato</th></tr></thead><tbody>${orders.map(o=>`<tr><td>${escapeHtml(o.id)}</td><td>${escapeHtml(o.date)}</td><td>${money(dashboardOrderTaxable(o))}</td><td>${money(o.amount)}</td><td>${escapeHtml(o.status)}</td></tr>`).join('') || '<tr><td colspan="5">Nessun ordine.</td></tr>'}</tbody></table></div></div>`;
  if (!byId('dashboard-detail-dialog').open) byId('dashboard-detail-dialog').showModal();
}

byId('show-login').addEventListener('click', () => setAuthMode('login'));
byId('show-register').addEventListener('click', () => setAuthMode('register'));
byId('show-password-recovery').addEventListener('click', () => {
  byId('recovery-email').value = byId('login-email').value.trim();
  setAuthMode('recovery');
});
byId('back-to-login').addEventListener('click', () => setAuthMode('login'));
byId('toggle-login-password').addEventListener('click', () => {
  const input = byId('login-password');
  const button = byId('toggle-login-password');
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.setAttribute('aria-label', reveal ? 'Nascondi password' : 'Mostra password');
  button.setAttribute('aria-pressed', String(reveal));
});
byId('change-password-form').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (toggle) togglePasswordField(toggle);
});
byId('change-password-form').addEventListener('submit', changePassword);
byId('login-form').addEventListener('submit', submitLogin);
byId('register-form').addEventListener('submit', submitRegistration);
byId('register-role').addEventListener('change', updateRegistrationCodeRequirement);
byId('register-code').addEventListener('blur', checkRegistrationCode);
byId('register-code').addEventListener('input', () => {
  byId('register-code').setCustomValidity('');
  setRegistrationCodeError('');
});
byId('password-recovery-form').addEventListener('submit', submitPasswordRecovery);
byId('password-reset-form').addEventListener('submit', submitPasswordReset);
byId('password-reset-form').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-password-toggle]');
  if (toggle) togglePasswordField(toggle);
});
byId('logout-button').addEventListener('click', submitLogout);
byId('refresh-users').addEventListener('click', loadAdminUsers);
byId('admin-users-table').addEventListener('click', handleAdminUserAction);
byId('new-agent-customer').addEventListener('click', () => {
  byId('agent-customer-form').reset(); byId('agent-customer-edit-id').value = '';
  byId('agent-customer-tax-code').required = false;
  byId('agent-customer-store').disabled = false;
  byId('agent-customer-store-category').disabled = false;
  byId('agent-customer-form').classList.remove('hidden');
});
byId('cancel-agent-customer').addEventListener('click', () => { byId('agent-customer-form').classList.add('hidden'); byId('agent-customer-edit-id').value = ''; });
byId('agent-customer-sole-trader').addEventListener('change', () => { byId('agent-customer-tax-code').required = byId('agent-customer-sole-trader').checked; });
byId('agent-customer-form').addEventListener('submit', saveAgentCustomer);
byId('agent-customer-list').addEventListener('click', handleAgentCustomerClick);
byId('agent-customer-search').addEventListener('input', renderAgentCustomers);
byId('permissions-table').addEventListener('change', updatePermission);
byId('validate-code').addEventListener('click', validateCode);
byId('new-code-button').addEventListener('click', () => openCodeForm());
byId('cancel-code-button').addEventListener('click', resetCodeForm);
byId('code-admin-form').addEventListener('submit', saveAdminCode);
byId('admin-code-table').addEventListener('click', handleCodeAdminAction);
byId('network-search').addEventListener('input', renderNetwork);
byId('new-network-button').addEventListener('click', () => openNetworkForm());
byId('cancel-network-button').addEventListener('click', closeNetworkForm);
byId('network-type').addEventListener('change', () => refreshNetworkFormOptions());
byId('network-form').addEventListener('submit', saveNetworkEntity);
byId('network-table').addEventListener('click', handleNetworkAction);
byId('network-import').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importNetworkFile(file);
});
byId('orders-import').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importOrdersFile(file);
});
byId('export-report').addEventListener('click', exportReport);
byId('new-promotion-button').addEventListener('click', () => openPromotionForm());
byId('cancel-promotion-button').addEventListener('click', closePromotionForm);
byId('promotion-form').addEventListener('submit', savePromotion);
byId('promotion-list').addEventListener('click', handlePromotionAction);
byId('report-search').addEventListener('input', renderOrders);
byId('report-status').addEventListener('change', renderOrders);
byId('report-payment').addEventListener('change', renderOrders);
byId('report-date-from').addEventListener('change', renderOrders);
byId('report-date-to').addEventListener('change', renderOrders);
byId('refresh-report').addEventListener('click', loadWooOrders);
byId('admin-dashboard-period').addEventListener('change', () => {
  syncDashboardDateInputs();
  renderAdminDashboard();
});
['admin-dashboard-date-from', 'admin-dashboard-date-to'].forEach((id) => byId(id).addEventListener('change', () => {
  byId('admin-dashboard-period').value = 'custom';
  renderAdminDashboard();
}));
byId('orders-table').addEventListener('click', (event) => {
  const assignment = event.target.closest('[data-save-assignment]');
  if (assignment) { saveOrderAssignment(assignment); return; }
  const button = event.target.closest('[data-order-payment]');
  if (button) registerOrderPayment(button);
});
byId('shop-search').addEventListener('input', renderShopProducts);
byId('shop-products').addEventListener('click', (event) => {
  const expandButton = event.target.closest('[data-product-expand]');
  if (expandButton) {
    openProductDetail(Number(expandButton.dataset.productExpand));
    return;
  }
  const downloadButton = event.target.closest('[data-package-document-download]');
  if (downloadButton) {
    downloadPackageDocument(downloadButton.dataset.packageDocumentDownload, downloadButton);
    return;
  }
  const deleteButton = event.target.closest('[data-package-document-delete]');
  if (deleteButton) {
    deletePackageDocument(deleteButton.dataset.packageDocumentDelete);
    return;
  }
  const quantityButton = event.target.closest('[data-product-quantity]');
  if (quantityButton) {
    const productId = Number(quantityButton.dataset.productId);
    if (quantityButton.dataset.productQuantity === 'increase') {
      addToShopCart(productId);
      renderShopProducts();
    } else {
      updateShopCartItem(productId, 'decrease');
    }
    return;
  }
  const cartButton = event.target.closest('[data-cart-add]');
  if (cartButton) {
    addToShopCart(Number(cartButton.dataset.cartAdd), cartButton);
    return;
  }
  const link = event.target.closest('[data-shop-destination]');
  if (!link) return;
  event.preventDefault();
  openWooSession(link.dataset.shopDestination, link);
});
byId('product-detail-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget || event.target.closest('[data-product-detail-close]')) {
    event.currentTarget.close();
    return;
  }
  const quantityButton = event.target.closest('[data-detail-quantity]');
  if (!quantityButton) return;
  const productId = Number(quantityButton.dataset.productId);
  if (quantityButton.dataset.detailQuantity === 'increase') addToShopCart(productId);
  else updateShopCartItem(productId, 'decrease');
  openProductDetail(productId);
});
byId('admin-dashboard').addEventListener('click', (event) => {
  const button = event.target.closest('[data-dashboard-detail]');
  if (button) openDashboardDetail(button.dataset.dashboardDetail);
});
byId('dashboard-detail-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget || event.target.closest('[data-dashboard-detail-close]')) event.currentTarget.close();
});
byId('shop-products').addEventListener('submit', (event) => {
  const form = event.target.closest('[data-package-document-form]');
  if (!form) return;
  event.preventDefault();
  uploadPackageDocument(form);
});
byId('shop-cart-link').addEventListener('click', (event) => {
  event.preventDefault();
  setCartPanel(byId('shop-cart-panel').classList.contains('hidden'));
});
byId('shop-cart-close').addEventListener('click', () => setCartPanel(false));
byId('shop-continue-shopping').addEventListener('click', () => {
  setCartPanel(false);
  byId('shop-products').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
byId('shop-continue-shopping-top').addEventListener('click', () => {
  setCartPanel(false);
  byId('shop-products').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
byId('shop-cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cart-action]');
  const item = event.target.closest('[data-cart-product]');
  if (!button || !item) return;
  updateShopCartItem(Number(item.dataset.cartProduct), button.dataset.cartAction);
});
const openBankCheckout = createBankCheckout({
  userId: () => currentUser?.id || '',
  escape: escapeHtml,
  money,
  clearCart: () => { byId('shop-order-notes').value = ''; shopCart = []; shopQuote = null; shopCoupon = ''; saveShopCart(); renderShopCart(); },
  api: async (body) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('Sessione scaduta. Accedi nuovamente.');
    const result = await fetch('/api/bank-checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body),
    });
    const payload = await result.json();
    if (!result.ok) { const error = new Error(payload.error || 'Conferma non disponibile'); error.code = payload.code; throw error; }
    return payload;
  },
});
byId('shop-checkout').addEventListener('click', (event) => {
  if (!shopCart.length) return;
  if (!validateShopAddress()) return;
  if (['agent', 'distributor', 'center'].includes(currentUser?.role)) {
    if (currentUser.role === 'agent' && !selectedAgentCustomer) {
      showRoute('agent-customers', { push: true });
      byId('shop-message').textContent = 'Seleziona il cliente per cui ordinare';
      return;
    }
    openBankCheckout({ orderNotes: byId('shop-order-notes').value, items: shopCart, coupon: shopCoupon, address: readShopAddress(), customerId: selectedAgentCustomer?.id || null });
    return;
  }
  openWooSession(
    new URL('/pagamento/', config.wooBaseUrl).toString(),
    event.currentTarget,
    shopCart.map(({ productId, quantity }) => ({ productId, quantity })),
    shopCoupon,
    { address: readShopAddress(), checkout: true },
  );
});
byId('shop-cart-panel').addEventListener('input', (event) => {
  if (event.target.closest('.shop-address')) {
    byId('shop-address-status').textContent = 'Modifiche non ancora salvate';
  }
});
byId('shipping-state').addEventListener('input', (event) => {
  event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
});
byId('shop-apply-coupon').addEventListener('click', () => applyShopCoupon());
byId('shop-coupon').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyShopCoupon();
  }
});
byId('shop-coupon').addEventListener('input', (event) => {
  if (event.currentTarget.value.trim().toLowerCase() === shopCoupon.toLowerCase()) return;
  shopCoupon = '';
  shopQuote = null;
  byId('shop-coupon-message').className = '';
  byId('shop-coupon-message').textContent = 'Premi Applica per verificare il nuovo codice.';
  renderShopCart();
});
byId('shop-categories').addEventListener('change', (event) => {
  shopCategory = event.currentTarget.value;
  renderShopProducts();
});
byId('marketing-upload-form').addEventListener('submit', uploadMarketingMaterial);
byId('marketing-list').addEventListener('click', (event) => {
  const downloadButton = event.target.closest('[data-marketing-download]');
  if (downloadButton) {
    downloadMarketingMaterial(downloadButton.dataset.marketingDownload, downloadButton);
    return;
  }
  const shareButton = event.target.closest('[data-marketing-share]');
  if (shareButton) {
    shareMarketingMaterial(shareButton.dataset.marketingShare, shareButton);
    return;
  }
  const deleteButton = event.target.closest('[data-marketing-delete]');
  if (deleteButton) deleteMarketingMaterial(deleteButton.dataset.marketingDelete);
});

syncDashboardDateInputs();
initSupabaseStatus();
initRouting();
if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event !== 'PASSWORD_RECOVERY') return;
    passwordRecoveryActive = true;
    setAuthMode('reset');
    showAuthMessage('Link verificato. Scegli ora la nuova password.', 'success');
  });
}
renderCodes();
renderPromotions();
renderNetwork();
renderOrders();
updateMetrics();
if (passwordRecoveryActive) setAuthMode('reset');
restoreSession();

['customer-report-search','customer-report-from','customer-report-to'].forEach(id => byId(id).addEventListener('input',renderAdminCustomerReport));
byId('customer-report-all').addEventListener('click', () => {
  byId('customer-report-from').value = ''; byId('customer-report-to').value = ''; renderAdminCustomerReport();
});
byId('customer-report-refresh').addEventListener('click', () => loadAdminCustomerReport(true));
byId('customer-report-table').addEventListener('click', event => {
  const button = event.target.closest('[data-customer-turnover]');
  if (button) openCustomerTurnover(Number(button.dataset.customerTurnover));
});

['products', 'promotions'].forEach(kind => {
  byId(`admin-${kind}-expand`).addEventListener('click', () => {
    if (currentUser?.role !== 'admin') return;
    dashboardSalesExpanded[kind] = !dashboardSalesExpanded[kind];
    renderAdminDashboard();
  });
});

byId('request-new-recovery-link').addEventListener('click', () => {
  passwordRecoveryActive = false;
  window.history.replaceState({}, '', '/recupera-password');
  setAuthMode('recovery');
});

byId('dashboard-profile-select').addEventListener('change', event => selectDashboardProfile(event.target.value));
byId('dashboard-profile-search').addEventListener('input', renderDashboardProfilePicker);
byId('dashboard-profile-reset').addEventListener('click', () => selectDashboardProfile(''));
