import { createClient } from '@supabase/supabase-js';

const runtimeConfig = window.__ODR_CONFIG__ || {};
const config = {
  supabaseUrl: runtimeConfig.supabaseUrl || '',
  supabasePublishableKey: runtimeConfig.supabasePublishableKey || '',
  wooBaseUrl: runtimeConfig.wooBaseUrl || 'https://odr.ioxina.com',
  wooShopPath: '/shop',
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
  patient: 'Paziente',
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

const moduleLabels = {
  dashboard: 'Dashboard',
  codes: 'Codici e convenzioni',
  promotions: 'Promozioni',
  network: 'Rete commerciale',
  wordpress: 'WordPress / shop',
  reports: 'Report vendite',
  users: 'Gestione utenti',
  permissions: 'Ruoli e permessi',
};

const appRoutes = {
  dashboard: { path: '/dashboard', title: 'Dashboard' },
  shop: { path: '/shop', title: 'Shop' },
  profile: { path: '/profilo', title: 'Il mio profilo' },
  access: { path: '/codici', title: 'Codici e convenzioni' },
  promotions: { path: '/promozioni', title: 'Promozioni' },
  network: { path: '/rete', title: 'Rete commerciale' },
  'agent-customers': { path: '/clienti', title: 'Gestione clienti' },
  wordpress: { path: '/wordpress', title: 'WordPress e WooCommerce' },
  reports: { path: '/report', title: 'Report vendite' },
  'admin-users': { path: '/utenti', title: 'Gestione utenti' },
  permissions: { path: '/permessi', title: 'Ruoli e permessi' },
  setup: { path: '/impostazioni', title: 'Impostazioni' },
};

let validatedCode = null;
let currentUser = null;
let authBusy = false;
let shopProducts = [];
let shopCategory = 'all';
let shopOpening = false;
let shopCart = [];
let shopCoupon = '';
let shopQuote = null;
let shopAddressLoaded = false;

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function routeFromPath(pathname) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return Object.entries(appRoutes).find(([, route]) => route.path === normalized)?.[0] || 'dashboard';
}

function closeMobileMenu() {
  byId('mobile-menu-button').setAttribute('aria-expanded', 'false');
  document.querySelector('.nav').classList.remove('mobile-open');
  byId('mobile-nav-backdrop').classList.add('hidden');
}

function openMobileMenu() {
  byId('mobile-menu-button').setAttribute('aria-expanded', 'true');
  document.querySelector('.nav').classList.add('mobile-open');
  byId('mobile-nav-backdrop').classList.remove('hidden');
}

function showRoute(routeId, options = {}) {
  const requested = appRoutes[routeId] ? routeId : 'dashboard';
  const target = byId(requested);
  const blocked = !target || target.classList.contains('module-denied');
  const activeRoute = blocked
    ? [...document.querySelectorAll('.route-screen:not(.module-denied)')][0]?.id || 'dashboard'
    : requested;

  document.querySelectorAll('.route-screen').forEach((section) => {
    section.classList.toggle('route-active', section.id === activeRoute);
  });
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === activeRoute);
  });

  const route = appRoutes[activeRoute];
  byId('page-title').textContent = route.title;
  document.title = `${route.title} · ODR`;
  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: options.smooth ? 'smooth' : 'auto' });

  if (options.push !== false && window.location.pathname !== route.path) {
    window.history.pushState({ route: activeRoute }, '', route.path);
  } else if (window.location.pathname === '/') {
    window.history.replaceState({ route: activeRoute }, '', route.path);
  }
}

function initRouting() {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showRoute(link.dataset.route, { push: true, smooth: true });
    });
  });
  window.addEventListener('popstate', () => showRoute(routeFromPath(window.location.pathname), { push: false }));
  byId('mobile-menu-button').addEventListener('click', () => {
    const open = byId('mobile-menu-button').getAttribute('aria-expanded') === 'true';
    open ? closeMobileMenu() : openMobileMenu();
  });
  byId('mobile-nav-backdrop').addEventListener('click', closeMobileMenu);
  showRoute(routeFromPath(window.location.pathname), { push: false });
}

function buildShopUrl(code) {
  const url = new URL(config.wooShopPath, config.wooBaseUrl);
  if (code?.coupon) url.searchParams.set('coupon', code.coupon);
  if (code?.code) url.searchParams.set('odr_code', code.code);
  return url.toString();
}

function productPrice(product) {
  if (!product.price) return 'Prezzo su richiesta';
  return money(Number(product.price));
}

function productCatalogImage(product) {
  if (!product?.image) return '';
  const image = new URL(product.image, config.wooBaseUrl);
  if (product.imageUpdatedAt) image.searchParams.set('odr_v', product.imageUpdatedAt);
  return image.toString();
}

function cartStorageKey() {
  return currentUser?.id ? `odr-cart:${currentUser.id}` : 'odr-cart';
}

function addressStorageKey() {
  return currentUser?.id ? `odr-address:${currentUser.id}` : 'odr-address';
}

const shippingFieldIds = {
  firstName: 'shipping-first-name',
  lastName: 'shipping-last-name',
  company: 'shipping-company',
  address1: 'shipping-address-1',
  address2: 'shipping-address-2',
  postcode: 'shipping-postcode',
  city: 'shipping-city',
  state: 'shipping-state',
  country: 'shipping-country',
  phone: 'shipping-phone',
  email: 'shipping-email',
};

function readShopAddress() {
  return Object.fromEntries(Object.entries(shippingFieldIds).map(([key, id]) => [key, byId(id).value.trim()]));
}

function fillShopAddress(address = {}) {
  Object.entries(shippingFieldIds).forEach(([key, id]) => {
    if (address[key] !== undefined && address[key] !== null) byId(id).value = address[key];
  });
  byId('shipping-email').value = currentUser?.role === 'agent' && selectedAgentCustomer
    ? (address.email || selectedAgentCustomer.email || '')
    : (currentUser?.email || address.email || '');
}

function saveShopAddress() {
  if (!currentUser) return;
  localStorage.setItem(addressStorageKey(), JSON.stringify(readShopAddress()));
  byId('shop-address-status').textContent = 'Dati salvati nell’app';
}

function storedShopAddress() {
  try {
    return JSON.parse(localStorage.getItem(addressStorageKey()) || 'null');
  } catch {
    return null;
  }
}

function validateShopAddress() {
  const required = [
    'shipping-first-name', 'shipping-last-name', 'shipping-address-1',
    'shipping-postcode', 'shipping-city', 'shipping-state', 'shipping-phone',
  ];
  const invalid = required.map(byId).find((field) => !field.value.trim());
  if (invalid) {
    invalid.focus();
    byId('shop-address-status').textContent = 'Completa tutti i campi obbligatori';
    return false;
  }
  if (!/^[A-Za-z]{2}$/.test(byId('shipping-state').value.trim())) {
    byId('shipping-state').focus();
    byId('shop-address-status').textContent = 'Inserisci la sigla della provincia (es. TO)';
    return false;
  }
  saveShopAddress();
  return true;
}

async function loadShopAddress() {
  if (!supabase || !currentUser || shopAddressLoaded) return;
  const stored = storedShopAddress();
  if (stored) {
    fillShopAddress(stored);
    shopAddressLoaded = true;
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const response = await fetch('/api/customer-address', {
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
    });
    const payload = await response.json();
    if (response.ok && payload.address) {
      fillShopAddress(payload.address);
      saveShopAddress();
    }
  } catch {
    fillShopAddress({
      firstName: currentUser.profile?.full_name?.split(/\s+/)[0] || '',
      lastName: currentUser.profile?.full_name?.split(/\s+/).slice(1).join(' ') || '',
      phone: currentUser.profile?.phone || '',
      email: currentUser.email,
      country: 'IT',
    });
  }
  shopAddressLoaded = true;
}

function saveShopCart() {
  localStorage.setItem(cartStorageKey(), JSON.stringify(shopCart));
}

function loadShopCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(cartStorageKey()) || '[]');
    shopCart = Array.isArray(saved)
      ? saved
        .map((item) => ({
          productId: Number(item.productId),
          quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)),
        }))
        .filter((item) => Number.isInteger(item.productId) && item.productId > 0)
      : [];
  } catch {
    shopCart = [];
  }
}

function cartProduct(productId) {
  return shopProducts.find((product) => product.id === productId);
}

function renderShopCart() {
  shopCart = shopCart.filter((item) => cartProduct(item.productId)?.inStock);
  saveShopCart();
  const count = shopCart.reduce((sum, item) => sum + item.quantity, 0);
  byId('shop-cart-count').textContent = String(count);

  if (!shopCart.length) {
    byId('shop-cart-items').innerHTML = '<div class="shop-cart-empty">Il carrello è vuoto. Aggiungi uno o più prodotti.</div>';
    byId('shop-cart-subtotal').textContent = money(0);
    byId('shop-cart-discount').textContent = `− ${money(0)}`;
    byId('shop-discount-row').classList.add('hidden');
    byId('shop-cart-total').textContent = money(0);
    byId('shop-checkout').disabled = true;
    return;
  }

  let total = 0;
  byId('shop-cart-items').innerHTML = shopCart.map((item) => {
    const product = cartProduct(item.productId);
    const unitPrice = Number(product.price) || 0;
    total += unitPrice * item.quantity;
    const productImage = productCatalogImage(product);
    const image = productImage
      ? `<img src="${escapeHtml(productImage)}" alt="" loading="lazy" />`
      : '<span class="cart-thumb-placeholder">ODR</span>';
    return `
      <article class="shop-cart-item" data-cart-product="${product.id}">
        <div class="shop-cart-thumb">${image}</div>
        <div class="shop-cart-copy">
          <small>${escapeHtml(product.sku || 'Prodotto ODR')}</small>
          <strong>${escapeHtml(product.name)}</strong>
          <span>${money(unitPrice)}</span>
        </div>
        <div class="shop-cart-quantity" aria-label="Quantità">
          <button type="button" data-cart-action="decrease" aria-label="Riduci quantità">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-action="increase" aria-label="Aumenta quantità">+</button>
        </div>
        <button class="shop-cart-remove" type="button" data-cart-action="remove">Rimuovi</button>
      </article>
    `;
  }).join('');
  const subtotal = shopQuote?.subtotal ?? total;
  const discount = shopQuote?.discount ?? 0;
  byId('shop-cart-subtotal').textContent = money(subtotal);
  byId('shop-cart-discount').textContent = `− ${money(discount)}`;
  byId('shop-discount-row').classList.toggle('hidden', discount <= 0);
  byId('shop-cart-total').textContent = money(shopQuote?.total ?? total);
  byId('shop-checkout').disabled = false;
}

function setCartPanel(open) {
  byId('shop-cart-panel').classList.toggle('hidden', !open);
  byId('shop-cart-link').setAttribute('aria-expanded', String(open));
  if (open) byId('shop-cart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addToShopCart(productId, trigger) {
  const product = cartProduct(productId);
  if (!product?.inStock) return;
  const existing = shopCart.find((item) => item.productId === productId);
  if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
  else shopCart.push({ productId, quantity: 1 });
  shopQuote = null;
  saveShopCart();
  renderShopCart();
  if (shopCoupon) applyShopCoupon({ silent: true });
  if (trigger) {
    const originalText = trigger.textContent;
    trigger.textContent = 'Aggiunto ✓';
    trigger.classList.add('added');
    window.setTimeout(() => {
      trigger.textContent = originalText;
      trigger.classList.remove('added');
    }, 900);
  }
}

function updateShopCartItem(productId, action) {
  const item = shopCart.find((row) => row.productId === productId);
  if (!item) return;
  if (action === 'increase') item.quantity = Math.min(99, item.quantity + 1);
  if (action === 'decrease') item.quantity -= 1;
  if (action === 'remove' || item.quantity < 1) {
    shopCart = shopCart.filter((row) => row.productId !== productId);
  }
  shopQuote = null;
  saveShopCart();
  renderShopCart();
  if (shopCoupon && shopCart.length) applyShopCoupon({ silent: true });
}

function renderShopProducts() {
  const query = byId('shop-search').value.trim().toLowerCase();
  const categoryGroup = (product) => {
    const categories = product.categories.filter((category) => (
      !`${category.slug} ${category.name}`.toLowerCase().includes('promo')
    ));
    return categories
      .map((category) => `${category.name} ${category.slug}`.toLowerCase())
      .sort((a, b) => a.localeCompare(b, 'it'))[0] || 'zzzz';
  };
  const products = shopProducts.filter((product) => {
    const isPromotion = product.onSale || product.categories.some((category) => (
      `${category.slug} ${category.name}`.toLowerCase().includes('promo')
    ));
    const matchesCategory = shopCategory === 'all'
      || (shopCategory === 'promo' && isPromotion)
      || product.categories.some((category) => category.slug === shopCategory);
    const matchesQuery = !query
      || `${product.name} ${product.sku}`.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  }).sort((a, b) => {
    const groupDifference = categoryGroup(a).localeCompare(categoryGroup(b), 'it');
    return groupDifference || a.name.localeCompare(b.name, 'it');
  });

  byId('shop-products').innerHTML = products.map((product) => {
    const category = product.categories[0]?.name || 'ODR';
    const productImage = productCatalogImage(product);
    const image = productImage
      ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(product.name)}" loading="lazy" />`
      : '<div class="product-placeholder">ODR</div>';
    const priceClass = product.onSale ? 'product-price on-sale' : 'product-price';
    const regular = product.onSale && product.regularPrice
      ? `<del>${money(Number(product.regularPrice))}</del>`
      : '';
    return `
      <article class="product-card">
        <div class="product-image">${image}<span>${escapeHtml(category)}</span></div>
        <div class="product-copy">
          <small>${escapeHtml(product.sku || 'Prodotto ODR')}</small>
          <h3>${escapeHtml(product.name)}</h3>
          <div class="${priceClass}">${regular}<strong>${productPrice(product)}</strong></div>
          <div class="product-actions">
            <span class="stock ${product.inStock ? 'ok' : 'off'}">${product.inStock ? 'Disponibile' : 'Esaurito'}</span>
            ${product.inStock
    ? `<button type="button" data-cart-add="${product.id}">Aggiungi</button>`
    : `<a href="${escapeHtml(product.permalink)}" data-shop-destination="${escapeHtml(product.permalink)}">Dettagli</a>`}
          </div>
        </div>
      </article>
    `;
  }).join('');

  byId('shop-message').classList.toggle('hidden', products.length > 0);
  if (!products.length) byId('shop-message').textContent = 'Nessun prodotto corrisponde ai filtri.';
}

async function openWooSession(destination, trigger, items = [], coupon = '', options = {}) {
  if (shopOpening || !supabase) return;
  shopOpening = true;
  const originalText = trigger?.textContent;
  if (trigger) {
    trigger.classList.add('loading');
    trigger.textContent = items.length ? 'Pagamento...' : 'Apertura...';
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessione ODR scaduta');
    if (currentUser?.role === 'agent' && options.checkout && !selectedAgentCustomer) {
      showRoute('agent-customers', { push: true });
      throw new Error('Seleziona prima il cliente per cui stai effettuando l’ordine');
    }
    const agentCheckout = currentUser?.role === 'agent' && options.checkout;
    const response = await fetch(agentCheckout ? '/api/agent-order' : '/api/shop-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        redirect: destination,
        items,
        coupon,
        address: options.address || null,
        checkout: Boolean(options.checkout),
        customerId: selectedAgentCustomer?.id || null,
      }),
    });
    const payload = await response.json();
    const targetUrl = agentCheckout ? payload.paymentUrl : payload.url;
    if (!response.ok || !targetUrl) throw new Error(payload.error || 'Accesso allo shop non riuscito');
    if (items.length) {
      shopCart = [];
      saveShopCart();
    }
    window.location.assign(targetUrl);
  } catch (error) {
    byId('shop-message').classList.remove('hidden');
    byId('shop-message').textContent = `${error.message}. Riprova tra qualche secondo.`;
    shopOpening = false;
    if (trigger) {
      trigger.classList.remove('loading');
      trigger.textContent = originalText;
    }
  }
}

function renderShopCategories() {
  const categories = new Map();
  shopProducts.forEach((product) => product.categories.forEach((category) => {
    categories.set(category.slug, category.name);
  }));

  const categoryKey = ([slug, name]) => `${slug} ${name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const categoryRank = (category) => {
    const key = categoryKey(category);
    if (key.includes('facebody')) return 2;
    if (key.includes('face')) return 0;
    if (key.includes('body')) return 1;
    if (key.includes('hair')) return 3;
    if (key.includes('lash')) return 4;
    if (key.includes('fir')) return 5;
    return 6;
  };
  const orderedCategories = [...categories.entries()]
    .filter((category) => !categoryKey(category).includes('promo'))
    .sort((a, b) => {
    const rankDifference = categoryRank(a) - categoryRank(b);
    return rankDifference || a[1].localeCompare(b[1], 'it');
    });

  byId('shop-categories').innerHTML = [
    '<option value="promo">TUTTE LE PROMO</option>',
    ...orderedCategories.map(([slug, name]) => (
      `<option value="${escapeHtml(slug)}">${escapeHtml(name).toUpperCase()}</option>`
    )),
    '<option value="all">TUTTI I PRODOTTI</option>',
  ].join('');
  byId('shop-categories').value = shopCategory;
}

async function loadShop() {
  if (!supabase || !currentUser) return;
  byId('shop-message').classList.remove('hidden');
  byId('shop-message').textContent = 'Aggiornamento catalogo e listino in corso...';
  byId('shop-products').innerHTML = '';
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return;

  try {
    const response = await fetch(`/api/catalog?refresh=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Catalogo non disponibile');
    shopProducts = payload.products || [];
    shopCategory = 'all';
    loadShopCart();
    if (validatedCode?.woo_coupon && !shopCoupon) {
      shopCoupon = validatedCode.woo_coupon;
      byId('shop-coupon').value = shopCoupon;
    }
    renderShopCategories();
    renderShopProducts();
    renderShopCart();
    loadShopAddress();
    if (shopCoupon && shopCart.length) applyShopCoupon({ silent: true });
    byId('shop-intro').textContent =
      `${shopProducts.length} prodotti disponibili per il profilo ${roleLabels[currentUser.role] || currentUser.role}.`;
  } catch (error) {
    byId('shop-message').textContent = error.message || 'Catalogo temporaneamente non disponibile.';
  }
}

async function applyShopCoupon(options = {}) {
  const code = byId('shop-coupon').value.trim();
  const message = byId('shop-coupon-message');
  if (!shopCart.length) {
    message.textContent = 'Aggiungi almeno un prodotto prima di applicare il codice.';
    return false;
  }
  const button = byId('shop-apply-coupon');
  button.disabled = true;
  if (!options.silent) message.textContent = code ? 'Verifica del codice in corso...' : 'Aggiornamento del totale...';
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Sessione ODR scaduta');
    const response = await fetch('/api/cart-quote', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: shopCart.map(({ productId, quantity }) => ({ productId, quantity })),
        coupon: code,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Codice non applicabile');
    shopCoupon = payload.coupon?.code || '';
    shopQuote = payload;
    byId('shop-coupon').value = shopCoupon;
    message.className = shopCoupon ? 'success-text' : '';
    message.textContent = shopCoupon
      ? `Codice ${shopCoupon.toUpperCase()} applicato${payload.coupon?.description ? ` · ${payload.coupon.description}` : ''}.`
      : 'Totale aggiornato. Nessun codice promozionale applicato.';
    renderShopCart();
    return true;
  } catch (error) {
    shopCoupon = '';
    shopQuote = null;
    message.className = 'error-text';
    message.textContent = error.message;
    renderShopCart();
    return false;
  } finally {
    button.disabled = false;
  }
}

function updateMetrics() {
  const revenue = reportOrders.reduce((sum, order) => sum + order.amount, 0);
  byId('metric-revenue').textContent = money(revenue);
  byId('metric-codes').textContent = validationCodes.filter((code) => code.active).length;
  byId('metric-network').textContent = networkRows.filter((row) => row.active).length;
  byId('metric-role').textContent = roleLabels[byId('role').value] || 'Utente';
  byId('metric-email').textContent = byId('account-email').value;
  byId('wp-base-url').textContent = config.wooBaseUrl;
}

function renderCodes() {
  if (!validationCodes.length) {
    byId('code-list').innerHTML = '<div class="empty-box">Nessuna convenzione disponibile.</div>';
    return;
  }
  byId('code-list').innerHTML = validationCodes
    .map((code) => `
      <div class="list-row">
        <div>
          <strong>${code.code}</strong>
          <span>${escapeHtml(code.label)}${code.hospital ? ` · ${escapeHtml(code.hospital)}` : ''}</span>
        </div>
        <em class="state ${code.active ? 'ok' : 'off'}">${code.active ? 'Attivo' : 'Spento'}</em>
      </div>
    `)
    .join('');
}

function renderPromotions() {
  byId('promotion-message').classList.toggle('hidden', promotions.length > 0);
  if (!promotions.length) {
    byId('promotion-list').innerHTML = '';
    return;
  }
  byId('promotion-list').innerHTML = promotions
    .map((promo) => `
      <article class="promo-card">
        <div>
          <span>${escapeHtml(promo.discountType === 'percent' ? 'Sconto percentuale' : 'Sconto sul carrello')}</span>
          <h3>${escapeHtml(promo.code)}</h3>
        </div>
        <strong>${escapeHtml(promo.code)}</strong>
        <p>${escapeHtml(promo.description || `${promo.discountType}: ${promo.amount}`)}</p>
        <div class="promo-meta">
          <span>${escapeHtml(promo.discountType === 'percent' ? `${promo.amount}%` : money(Number(promo.amount) || 0))}</span>
          <span>${promo.usageCount || 0}${promo.usageLimit ? ` / ${promo.usageLimit}` : ''} utilizzi</span>
          <span>${promo.expiresAt ? `Scade ${codeDate(promo.expiresAt)}` : 'Nessuna scadenza'}</span>
        </div>
        <div class="promo-actions">
          <em class="state ${promo.expired ? 'off' : 'ok'}">${promo.expired ? 'Scaduto' : 'Attivo'}</em>
          <button type="button" data-promotion-edit="${promo.id}">Modifica</button>
        </div>
      </article>
    `)
    .join('');
}

function codeDate(value) {
  return value ? new Date(value).toLocaleDateString('it-IT') : 'Nessuna';
}

function renderAdminCodes() {
  byId('admin-code-table').innerHTML = validationCodes.map((code) => `
    <tr>
      <td data-label="Codice"><strong>${escapeHtml(code.code)}</strong></td>
      <td data-label="Convenzione">${escapeHtml(code.label)}${code.hospital ? `<br><small>${escapeHtml(code.hospital)}</small>` : ''}</td>
      <td data-label="Coupon">${escapeHtml(code.woo_coupon)}</td>
      <td data-label="Profilo">${escapeHtml(roleLabels[code.audience_role] || 'Tutti')}</td>
      <td data-label="Utilizzi">${code.current_uses}${code.max_uses ? ` / ${code.max_uses}` : ''}</td>
      <td data-label="Scadenza">${codeDate(code.ends_at)}</td>
      <td data-label="Stato"><span class="state ${code.active ? 'ok' : 'off'}">${code.active ? 'Attivo' : 'Spento'}</span></td>
      <td data-label="Azioni">
        <div class="user-actions">
          <button type="button" data-code-edit="${code.id}">Modifica</button>
          <button type="button" data-code-toggle="${code.id}" data-code-active="${code.active ? 'false' : 'true'}">
            ${code.active ? 'Disattiva' : 'Attiva'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
  byId('code-validation-history').innerHTML = codeValidations.length
    ? codeValidations.map((entry) => {
      const profile = entry.profiles || {};
      return `<div class="list-row">
        <div><strong>${escapeHtml(entry.code)}</strong><span>${escapeHtml(profile.full_name || profile.email || 'Utente')}</span></div>
        <div><span class="state ${entry.valid ? 'ok' : 'off'}">${entry.valid ? 'Valido' : escapeHtml(entry.failure_reason || 'Rifiutato')}</span><small>${codeDate(entry.created_at)}</small></div>
      </div>`;
    }).join('')
    : '<div class="empty-box">Nessuna validazione registrata.</div>';
}

function resetCodeForm() {
  byId('code-admin-form').reset();
  byId('admin-code-id').value = '';
  byId('admin-code-active').checked = true;
  byId('code-admin-form').classList.add('hidden');
}

function openCodeForm(code = null) {
  byId('code-admin-form').classList.remove('hidden');
  byId('admin-code-id').value = code?.id || '';
  byId('admin-code-value').value = code?.code || `ODR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  byId('admin-code-label').value = code?.label || '';
  byId('admin-code-hospital').value = code?.hospital || '';
  byId('admin-code-discount').value = code?.discount_label || '';
  byId('admin-code-coupon').value = code?.woo_coupon || '';
  byId('admin-code-audience').value = code?.audience_role || '';
  byId('admin-code-start').value = code?.starts_at ? code.starts_at.slice(0, 16) : '';
  byId('admin-code-end').value = code?.ends_at ? code.ends_at.slice(0, 16) : '';
  byId('admin-code-max').value = code?.max_uses || '';
  byId('admin-code-active').checked = code?.active ?? true;
  byId('admin-code-value').focus();
}

async function loadWooCoupons() {
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/coupons', {
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Coupon non disponibili');
  promotions = (payload.coupons || []).map((coupon) => ({
    ...coupon,
    expired: coupon.expiresAt ? Date.parse(coupon.expiresAt) < Date.now() : false,
  }));
  byId('admin-code-coupon').innerHTML = [
    '<option value="">Seleziona un coupon</option>',
    ...promotions.map((coupon) => `<option value="${escapeHtml(coupon.code)}">${escapeHtml(coupon.code)} · ${escapeHtml(coupon.amount)}</option>`),
  ].join('');
  renderPromotions();
}

function openPromotionForm(coupon = null) {
  byId('promotion-form').classList.remove('hidden');
  byId('promotion-id').value = coupon?.id || '';
  byId('promotion-code').value = coupon?.code || '';
  byId('promotion-code').readOnly = Boolean(coupon?.id);
  byId('promotion-type').value = coupon?.discountType || 'percent';
  byId('promotion-amount').value = coupon?.amount || '';
  byId('promotion-expires').value = coupon?.expiresAt ? coupon.expiresAt.slice(0, 10) : '';
  byId('promotion-usage-limit').value = coupon?.usageLimit || '';
  byId('promotion-user-limit').value = coupon?.usageLimitPerUser || '';
  byId('promotion-minimum').value = coupon?.minimumAmount || '';
  byId('promotion-maximum').value = coupon?.maximumAmount || '';
  byId('promotion-description').value = coupon?.description || '';
  byId('promotion-individual').checked = Boolean(coupon?.individualUse);
  byId('promotion-free-shipping').checked = Boolean(coupon?.freeShipping);
  byId('promotion-exclude-sale').checked = Boolean(coupon?.excludeSaleItems);
  byId('promotion-code').focus();
}

function closePromotionForm() {
  byId('promotion-form').reset();
  byId('promotion-id').value = '';
  byId('promotion-form').classList.add('hidden');
}

async function savePromotion(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  byId('promotion-message').textContent = 'Salvataggio coupon in WooCommerce...';
  const id = byId('promotion-id').value;
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/coupons', {
    method: id ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${data.session?.access_token || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: id || undefined,
      code: byId('promotion-code').value,
      discountType: byId('promotion-type').value,
      amount: byId('promotion-amount').value,
      expiresAt: byId('promotion-expires').value || null,
      usageLimit: byId('promotion-usage-limit').value || null,
      usageLimitPerUser: byId('promotion-user-limit').value || null,
      minimumAmount: byId('promotion-minimum').value,
      maximumAmount: byId('promotion-maximum').value,
      description: byId('promotion-description').value,
      individualUse: byId('promotion-individual').checked,
      freeShipping: byId('promotion-free-shipping').checked,
      excludeSaleItems: byId('promotion-exclude-sale').checked,
    }),
  });
  const payload = await response.json();
  if (button) button.disabled = false;
  if (!response.ok) {
    byId('promotion-message').textContent = payload.error || 'Salvataggio non riuscito.';
    return;
  }
  closePromotionForm();
  await loadWooCoupons();
  byId('promotion-message').textContent = id ? 'Coupon aggiornato.' : 'Coupon creato.';
}

function handlePromotionAction(event) {
  const button = event.target.closest('[data-promotion-edit]');
  if (!button) return;
  openPromotionForm(promotions.find((coupon) => String(coupon.id) === button.dataset.promotionEdit));
}

async function loadWooOrders() {
  byId('report-message').textContent = 'Aggiornamento ordini WooCommerce...';
  const { data } = await supabase.auth.getSession();
  const response = await fetch('/api/orders', {
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    byId('report-message').textContent = payload.error || 'Report temporaneamente non disponibile.';
    return;
  }
  reportOrders = payload.orders || [];
  renderOrders();
  updateMetrics();
  byId('report-message').textContent = `${reportOrders.length} ordini WooCommerce caricati.`;
}

async function loadPromoCodes() {
  const { data, error } = await supabase.functions.invoke('promo-codes', { method: 'GET' });
  if (error || data?.error) {
    byId('code-admin-message').textContent = data?.error || 'Codici non disponibili.';
    return;
  }
  validationCodes = data.codes || [];
  codeValidations = data.validations || [];
  renderCodes();
  if (currentUser?.role === 'admin') {
    renderAdminCodes();
    byId('code-admin-message').textContent = `${validationCodes.length} codici ODR configurati.`;
  }
}

async function loadActivePromoCode() {
  const { data: sessionData } = await supabase.auth.getSession();
  const response = await fetch(`${config.supabaseUrl}/functions/v1/promo-codes?view=active`, {
    headers: {
      apikey: config.supabasePublishableKey,
      Authorization: `Bearer ${sessionData.session?.access_token || ''}`,
    },
  });
  const payload = response.ok ? await response.json() : {};
  if (payload.activeCode) {
    validatedCode = payload.activeCode;
    byId('code-result').className = 'success-box';
    byId('code-result').innerHTML = `<div><strong>${escapeHtml(validatedCode.label)}</strong><span>${escapeHtml(validatedCode.discount_label || 'Convenzione attiva')}</span></div>`;
    if (!shopCoupon && validatedCode.woo_coupon) {
      shopCoupon = validatedCode.woo_coupon;
      byId('shop-coupon').value = shopCoupon;
      if (shopCart.length) applyShopCoupon({ silent: true });
    }
  }
}

async function saveAdminCode(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  const body = {
    action: 'save',
    id: byId('admin-code-id').value || null,
    code: byId('admin-code-value').value,
    label: byId('admin-code-label').value,
    hospital: byId('admin-code-hospital').value,
    discountLabel: byId('admin-code-discount').value,
    wooCoupon: byId('admin-code-coupon').value,
    audienceRole: byId('admin-code-audience').value || null,
    startsAt: byId('admin-code-start').value ? new Date(byId('admin-code-start').value).toISOString() : null,
    endsAt: byId('admin-code-end').value ? new Date(byId('admin-code-end').value).toISOString() : null,
    maxUses: byId('admin-code-max').value || null,
    active: byId('admin-code-active').checked,
  };
  const { data, error } = await supabase.functions.invoke('promo-codes', { method: 'POST', body });
  if (button) button.disabled = false;
  if (error || data?.error) {
    byId('code-admin-message').textContent = data?.error || 'Salvataggio non riuscito.';
    return;
  }
  resetCodeForm();
  await loadPromoCodes();
}

async function handleCodeAdminAction(event) {
  const edit = event.target.closest('[data-code-edit]');
  if (edit) {
    openCodeForm(validationCodes.find((code) => code.id === edit.dataset.codeEdit));
    return;
  }
  const toggle = event.target.closest('[data-code-toggle]');
  if (!toggle) return;
  toggle.disabled = true;
  const { data, error } = await supabase.functions.invoke('promo-codes', {
    method: 'POST',
    body: { action: 'toggle', id: toggle.dataset.codeToggle, active: toggle.dataset.codeActive === 'true' },
  });
  if (error || data?.error) byId('code-admin-message').textContent = data?.error || 'Aggiornamento non riuscito.';
  await loadPromoCodes();
}

function renderNetwork() {
  const query = byId('network-search').value.trim().toLowerCase();
  const rows = networkRows.filter((row) => {
    if (!query) return true;
    return [row.type, row.name, row.email, row.phone, row.area, row.parentName, row.accountName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  byId('network-table').innerHTML = rows
    .map((row) => `
      <tr>
        <td data-label="Tipo">${escapeHtml(roleLabels[row.type] || row.type)}</td>
        <td data-label="Nome"><strong>${escapeHtml(row.name)}</strong>${row.external_code ? `<br><small>${escapeHtml(row.external_code)}</small>` : ''}</td>
        <td data-label="Zona">${escapeHtml(row.area || '-')}</td>
        <td data-label="Collegato a">${escapeHtml(row.parentName || '-')}</td>
        <td data-label="Provvigione">${row.type === 'agent' ? `${(Number(row.commission_rate || 0) * 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%` : '-'}</td>
        <td data-label="Contatto">${escapeHtml(row.email || row.phone || '-')}</td>
        <td data-label="Account ODR">${escapeHtml(row.accountName || 'Non collegato')}</td>
        <td data-label="Stato"><span class="state ${row.active ? 'ok' : 'off'}">${row.active ? 'Attivo' : 'Spento'}</span></td>
        <td data-label="Azioni">${canManageNetwork ? `<div class="user-actions">
          <button type="button" data-network-edit="${row.id}">Modifica</button>
          <button type="button" data-network-toggle="${row.id}" data-network-active="${row.active ? 'false' : 'true'}">${row.active ? 'Disattiva' : 'Attiva'}</button>
        </div>` : '-'}</td>
      </tr>
    `)
    .join('');
}

function normalizeNetworkRows(entities = [], accounts = []) {
  const byEntity = new Map(entities.map((entity) => [entity.id, entity]));
  const accountByEntity = new Map(accounts
    .filter((account) => account.network_entity_id)
    .map((account) => [account.network_entity_id, account]));
  return entities.map((entity) => {
    const account = accountByEntity.get(entity.id);
    return {
      ...entity,
      parentName: byEntity.get(entity.parent_id)?.name || '',
      accountId: account?.id || '',
      accountName: account ? (account.full_name || account.email) : '',
    };
  });
}

async function loadNetwork() {
  if (!supabase || !currentUser) return;
  byId('import-notice').textContent = 'Caricamento rete...';
  const { data, error } = await supabase.functions.invoke('network-management', { method: 'GET' });
  if (error || data?.error) {
    byId('import-notice').textContent = data?.error || 'Rete non disponibile.';
    return;
  }
  networkAccounts = data.accounts || [];
  canManageNetwork = Boolean(data.canManage);
  networkRows = normalizeNetworkRows(data.entities || [], networkAccounts);
  byId('network-admin-actions').classList.toggle('hidden', !canManageNetwork);
  renderNetwork();
  updateMetrics();
  byId('import-notice').textContent = `${networkRows.length} elementi configurati.`;
}

function refreshNetworkFormOptions(selectedParent = '', selectedAccount = '') {
  const type = byId('network-type').value;
  const parentType = type === 'agent' ? 'distributor' : type === 'center' ? 'agent' : '';
  byId('network-commission-label').classList.toggle('hidden', type !== 'agent');
  const parents = networkRows.filter((row) => row.type === parentType && row.active);
  byId('network-parent').disabled = !parentType;
  byId('network-parent').required = Boolean(parentType);
  byId('network-parent').innerHTML = [
    `<option value="">${parentType ? 'Seleziona' : 'Nessun collegamento'}</option>`,
    ...parents.map((row) => `<option value="${row.id}">${escapeHtml(row.name)}</option>`),
  ].join('');
  byId('network-parent').value = selectedParent;

  const editingId = byId('network-id').value;
  const accounts = networkAccounts.filter((account) =>
    account.role === type && (!account.network_entity_id || account.network_entity_id === editingId));
  byId('network-account').innerHTML = [
    '<option value="">Nessun account</option>',
    ...accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.full_name || account.email)} · ${escapeHtml(account.email)}</option>`),
  ].join('');
  byId('network-account').value = selectedAccount;
}

function openNetworkForm(row = null) {
  byId('network-form').classList.remove('hidden');
  byId('network-id').value = row?.id || '';
  byId('network-type').value = row?.type || 'distributor';
  byId('network-name').value = row?.name || '';
  byId('network-area').value = row?.area || '';
  byId('network-email').value = row?.email || '';
  byId('network-phone').value = row?.phone || '';
  byId('network-external-code').value = row?.external_code || '';
  byId('network-commission').value = row?.type === 'agent'
    ? String(Number(row.commission_rate || 0.2) * 100)
    : '20';
  byId('network-active').checked = row?.active ?? true;
  refreshNetworkFormOptions(row?.parent_id || '', row?.accountId || '');
  byId('network-name').focus();
}

function closeNetworkForm() {
  byId('network-form').reset();
  byId('network-id').value = '';
  byId('network-form').classList.add('hidden');
}

async function saveNetworkEntity(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  byId('import-notice').textContent = 'Salvataggio in corso...';
  const { data, error } = await supabase.functions.invoke('network-management', {
    method: 'POST',
    body: {
      action: 'save',
      id: byId('network-id').value || null,
      type: byId('network-type').value,
      name: byId('network-name').value,
      area: byId('network-area').value,
      parentId: byId('network-parent').value || null,
      email: byId('network-email').value,
      phone: byId('network-phone').value,
      externalCode: byId('network-external-code').value,
      commissionRate: byId('network-type').value === 'agent'
        ? Number(byId('network-commission').value || 0) / 100
        : null,
      accountId: byId('network-account').value || null,
      active: byId('network-active').checked,
    },
  });
  if (button) button.disabled = false;
  if (error || data?.error) {
    byId('import-notice').textContent = data?.error || 'Salvataggio non riuscito.';
    return;
  }
  closeNetworkForm();
  await loadNetwork();
}

async function handleNetworkAction(event) {
  const edit = event.target.closest('[data-network-edit]');
  if (edit) {
    openNetworkForm(networkRows.find((row) => row.id === edit.dataset.networkEdit));
    return;
  }
  const toggle = event.target.closest('[data-network-toggle]');
  if (!toggle) return;
  toggle.disabled = true;
  const { data, error } = await supabase.functions.invoke('network-management', {
    method: 'POST',
    body: { action: 'toggle', id: toggle.dataset.networkToggle, active: toggle.dataset.networkActive === 'true' },
  });
  if (error || data?.error) byId('import-notice').textContent = data?.error || 'Aggiornamento non riuscito.';
  await loadNetwork();
}

function renderOrders() {
  const query = byId('report-search').value.trim().toLowerCase();
  const status = byId('report-status').value;
  const payment = byId('report-payment').value;
  const dateFrom = byId('report-date-from').value;
  const dateTo = byId('report-date-to').value;
  filteredReportOrders = reportOrders.filter((order) => {
    const haystack = [
      order.id, order.customer, order.customerEmail, order.coupon,
      order.agent, order.distributor, order.center,
    ].filter(Boolean).join(' ').toLowerCase();
    return (!query || haystack.includes(query))
      && (!status || order.status === status)
      && (!payment || order.paymentStatus === payment)
      && (!dateFrom || order.date >= dateFrom)
      && (!dateTo || order.date <= dateTo);
  });
  byId('orders-table').innerHTML = filteredReportOrders.length
    ? filteredReportOrders
    .map((order) => `
      <tr>
        <td data-label="Ordine">${escapeHtml(order.id)}</td>
        <td data-label="Data">${escapeHtml(order.date)}</td>
        <td data-label="Cliente"><strong>${escapeHtml(order.customer)}</strong>${order.customerEmail ? `<br><small>${escapeHtml(order.customerEmail)}</small>` : ''}</td>
        <td data-label="Coupon">${escapeHtml(order.coupon || '-')}</td>
        <td data-label="Agente">${escapeHtml(order.agent || '-')}</td>
        <td data-label="Distributore">${escapeHtml(order.distributor || '-')}</td>
        <td data-label="Centro">${escapeHtml(order.center || '-')}</td>
        <td data-label="Importo"><strong>${money(order.amount)}</strong></td>
        <td data-label="Pagamento"><span class="state ${order.paymentStatus === 'paid' ? 'ok' : 'off'}">${order.paymentStatus === 'paid' ? 'Pagato' : 'Non pagato'}</span></td>
        <td data-label="Imponibile provvigione">${order.agent ? money(order.commissionBase || 0) : '-'}</td>
        <td data-label="Guadagno agente"><strong>${order.agent ? money(order.agentEarning || 0) : '-'}</strong></td>
        <td data-label="Stato"><span class="state ${['cancelled', 'failed', 'refunded'].includes(order.status) ? 'off' : 'ok'}">${escapeHtml(order.status)}</span></td>
      </tr>
    `)
    .join('')
    : '<tr class="report-empty-row"><td colspan="12">Nessun ordine corrisponde ai filtri selezionati.</td></tr>';
  renderReportSummary();
}

function renderReportSummary() {
  const total = filteredReportOrders.reduce((sum, order) => sum + order.amount, 0);
  const totalAgentEarnings = filteredReportOrders.reduce((sum, order) => sum + (order.agentEarning || 0), 0);
  const byCoupon = filteredReportOrders.reduce((acc, order) => {
    const key = order.coupon || 'Senza coupon';
    acc[key] = (acc[key] || 0) + order.amount;
    return acc;
  }, {});
  const topCoupon = Object.entries(byCoupon).sort((a, b) => b[1] - a[1])[0];

  byId('report-summary').innerHTML = `
    <div><span>Ordini visualizzati</span><strong>${filteredReportOrders.length}</strong></div>
    <div><span>Totale vendite</span><strong>${money(total)}</strong></div>
    <div><span>Provvigioni agenti</span><strong>${money(totalAgentEarnings)}</strong></div>
    <div><span>Coupon principale</span><strong>${topCoupon ? `${topCoupon[0]} · ${money(topCoupon[1])}` : '-'}</strong></div>
  `;
}

function renderPermissions(rows) {
  const roles = ['admin', 'distributor', 'agent', 'center', 'patient'];
  byId('permissions-table').innerHTML = Object.keys(moduleLabels)
    .map((module) => `
      <tr>
        <td>${moduleLabels[module]}</td>
        ${roles.map((role) => {
          const permission = rows.find((row) => row.role === role && row.module === module);
          const checked = Boolean(permission?.can_view);
          const editable = currentUser?.role === 'admin' && role !== 'admin';
          return `<td>
            <input
              class="permission-toggle"
              type="checkbox"
              data-permission-role="${role}"
              data-permission-module="${module}"
              ${checked ? 'checked' : ''}
              ${editable ? '' : 'disabled'}
              aria-label="${moduleLabels[module]} - ${roleLabels[role]}"
            />
          </td>`;
        }).join('')}
      </tr>
    `)
    .join('');
}

function applyModuleVisibility(rows) {
  const role = currentUser?.role;
  if (!role) return;
  const sectionIds = {
    dashboard: 'dashboard',
    codes: 'access',
    promotions: 'promotions',
    network: 'network',
    wordpress: 'wordpress',
    reports: 'reports',
    users: 'admin-users',
    permissions: 'permissions',
  };

  Object.entries(sectionIds).forEach(([module, sectionId]) => {
    const hiddenForAgent = role === 'agent' && (module === 'promotions' || module === 'network');
    const allowed = !hiddenForAgent && rows.some((row) => row.role === role && row.module === module && row.can_view);
    byId(sectionId)?.classList.toggle('module-denied', !allowed);
    document.querySelectorAll(`[data-route="${sectionId}"]`).forEach((link) => {
      link.classList.toggle('hidden', !allowed);
    });
  });
  byId('setup')?.classList.toggle('module-denied', role !== 'admin');
  const agentCustomerAllowed = role === 'agent';
  byId('agent-customers')?.classList.toggle('module-denied', !agentCustomerAllowed);
  byId('agent-customers-nav')?.classList.toggle('hidden', !agentCustomerAllowed);
  document.querySelectorAll('[data-route="setup"]').forEach((link) => {
    link.classList.toggle('hidden', role !== 'admin');
  });
  showRoute(routeFromPath(window.location.pathname), { push: false });
}

async function loadPermissions() {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role,module,can_view')
    .order('module');
  if (error) {
    byId('permissions-message').textContent = 'Non è stato possibile caricare i permessi.';
    return;
  }
  renderPermissions(data || []);
  applyModuleVisibility(data || []);
  byId('permissions-message').textContent = currentUser?.role === 'admin'
    ? 'Le modifiche vengono applicate immediatamente.'
    : 'Visualizzazione dei permessi assegnati al tuo ruolo.';
}

async function updatePermission(event) {
  const checkbox = event.target.closest('[data-permission-role]');
  if (!checkbox || currentUser?.role !== 'admin') return;
  checkbox.disabled = true;
  const { data, error } = await supabase.functions.invoke('admin-permissions', {
    method: 'POST',
    body: {
      role: checkbox.dataset.permissionRole,
      module: checkbox.dataset.permissionModule,
      canView: checkbox.checked,
    },
  });
  if (error || data?.error) {
    checkbox.checked = !checkbox.checked;
    byId('permissions-message').textContent = data?.error || 'Modifica non riuscita.';
  } else {
    byId('permissions-message').textContent = 'Permesso aggiornato.';
  }
  checkbox.disabled = false;
}

async function validateCode() {
  const input = byId('code-input').value.trim();
  if (!input || !supabase) return;
  byId('validate-code').disabled = true;
  byId('code-result').className = 'empty-box';
  byId('code-result').innerHTML = '<span>Verifica del codice in corso...</span>';
  const { data, error } = await supabase.functions.invoke('promo-codes', {
    method: 'POST',
    body: { action: 'validate', code: input },
  });
  byId('validate-code').disabled = false;
  if (error || data?.error || !data?.valid) {
    validatedCode = null;
    byId('code-result').className = 'empty-box';
    byId('code-result').innerHTML = `<span>${escapeHtml(data?.error || 'Codice non valido o non attivo.')}</span>`;
    updateMetrics();
    return;
  }
  const found = data.activeCode;
  validatedCode = found;
  shopCoupon = found.woo_coupon || '';
  byId('shop-coupon').value = shopCoupon;
  shopQuote = null;
  if (shopCoupon && shopCart.length) applyShopCoupon({ silent: true });
  byId('code-result').className = 'success-box';
  byId('code-result').innerHTML = `
    <div>
      <strong>${escapeHtml(found.label)}</strong>
      <span>${escapeHtml(found.discount_label || 'Convenzione applicata al prossimo acquisto')}</span>
      <a href="/shop" data-route="shop">Vai ai prodotti</a>
    </div>
  `;
  byId('code-result').querySelector('[data-route]').addEventListener('click', (event) => {
    event.preventDefault();
    showRoute('shop', { push: true, smooth: true });
  });
  updateMetrics();
}

function setAuthMode(mode) {
  const loginActive = mode === 'login';
  byId('show-login').classList.toggle('active', loginActive);
  byId('show-register').classList.toggle('active', !loginActive);
  byId('login-form').classList.toggle('hidden', !loginActive);
  byId('register-form').classList.toggle('hidden', loginActive);
  showAuthMessage(
    loginActive
      ? ''
      : 'Il paziente viene attivato subito; gli altri profili richiedono approvazione.',
  );
}

function showAuthMessage(message, type = '') {
  const box = byId('auth-message');
  box.className = `auth-message${type ? ` ${type}` : ''}`;
  box.textContent = message;
}

function setAuthBusy(busy) {
  authBusy = busy;
  document.querySelectorAll('#login-form button, #register-form button').forEach((button) => {
    button.disabled = busy;
  });
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, requested_role, approval_status, full_name, phone, wordpress_user_id')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}

async function enterAuthenticatedApp(user) {
  const profile = await loadProfile(user.id);
  if (profile.approval_status !== 'approved') {
    await supabase.auth.signOut();
    const requested = roleLabels[profile.requested_role] || 'profilo professionale';
    showAuthMessage(
      `La richiesta come ${requested} è in attesa di approvazione dell'amministratore.`,
      'success',
    );
    return;
  }

  enterApp({
    id: user.id,
    email: user.email,
    code: user.user_metadata?.validation_code || '',
    role: profile.role,
    profile,
  });
}

function enterApp(user) {
  currentUser = user;
  byId('auth-screen').classList.add('hidden');
  byId('app-shell').classList.remove('hidden');
  byId('role').value = user.role;
  byId('account-email').value = user.email;
  byId('code-input').value = user.code || '';
  renderCurrentProfile(user);
  try {
    selectedAgentCustomer = user.role === 'agent'
      ? JSON.parse(localStorage.getItem('odr-agent-customer') || 'null')
      : null;
  } catch {
    selectedAgentCustomer = null;
    localStorage.removeItem('odr-agent-customer');
  }
  const isAdmin = user.role === 'admin';
  byId('admin-code-manager').classList.toggle('hidden', !isAdmin);
  byId('new-promotion-button').classList.toggle('hidden', !isAdmin);
  byId('admin-users-nav').classList.toggle('hidden', !isAdmin);
  byId('admin-users').classList.remove('hidden');
  byId('admin-users').classList.toggle('module-denied', !isAdmin);
  if (isAdmin) {
    loadAdminUsers();
    loadPromoCodes();
    loadWooCoupons().catch((error) => {
      byId('promotion-message').textContent = error.message;
      byId('code-admin-message').textContent = error.message;
    });
  } else {
    validationCodes = [];
    renderCodes();
  }
  loadActivePromoCode();
  loadPermissions();
  loadShop();
  loadWooOrders();
  if (user.role === 'agent') loadAgentCustomers();
  loadNetwork();
  updateMetrics();
}

function renderCurrentProfile(user) {
  byId('profile-name').textContent = user.profile?.full_name || '-';
  byId('profile-email').textContent = user.email || '-';
  byId('profile-role').textContent = roleLabels[user.role] || user.role;
  byId('profile-status').textContent = user.profile?.approval_status || '-';
  byId('profile-wordpress-id').textContent = user.profile?.wordpress_user_id || 'Non collegato';
  const linked = Boolean(user.profile?.wordpress_user_id);
  byId('profile-link-status').className = `config-pill${linked ? ' ok' : ''}`;
  byId('profile-link-status').textContent = linked ? 'Collegato a WordPress' : 'Solo ODR';
}

function renderAgentCustomers() {
  const list = byId('agent-customer-list');
  const selected = byId('agent-selected-customer');
  if (selectedAgentCustomer) {
    selected.classList.remove('hidden');
    selected.innerHTML = `<strong>Ordine per: ${escapeHtml(selectedAgentCustomer.name)}</strong><span>${escapeHtml(selectedAgentCustomer.email || '')}</span><button id="clear-agent-customer" type="button">Cambia cliente</button>`;
    byId('clear-agent-customer').addEventListener('click', () => {
      selectedAgentCustomer = null;
      localStorage.removeItem('odr-agent-customer');
      renderAgentCustomers();
    });
  } else {
    selected.classList.add('hidden');
    selected.innerHTML = '';
  }
  list.innerHTML = agentCustomers.length ? agentCustomers.map((customer) => `
    <article class="agent-customer-card${selectedAgentCustomer?.id === customer.id ? ' selected' : ''}">
      <div><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.email || '-')}</span><small>${escapeHtml(customer.phone || customer.area || '')}</small></div>
      <button class="primary-action" type="button" data-agent-customer="${customer.id}">Nuovo ordine</button>
    </article>
  `).join('') : '<div class="empty-box">Nessun cliente collegato. Premi “Aggiungi cliente” per iniziare.</div>';
}

async function loadAgentCustomers() {
  if (!supabase || !['agent', 'admin'].includes(currentUser?.role)) return;
  byId('agent-customer-message').textContent = 'Caricamento clienti...';
  const { data } = await supabase.auth.getSession();
  try {
    const response = await fetch('/api/agent-customers', { headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Clienti non disponibili');
    agentCustomers = payload.customers || [];
    if (selectedAgentCustomer) {
      const refreshedCustomer = agentCustomers.find((item) => item.id === selectedAgentCustomer.id);
      if (refreshedCustomer) {
        selectedAgentCustomer = refreshedCustomer;
        localStorage.setItem('odr-agent-customer', JSON.stringify(refreshedCustomer));
        fillShopAddress(refreshedCustomer.address || {});
      } else {
        selectedAgentCustomer = null;
        localStorage.removeItem('odr-agent-customer');
      }
    }
    renderAgentCustomers();
    byId('agent-customer-message').textContent = `${agentCustomers.length} clienti disponibili.`;
  } catch (error) {
    byId('agent-customer-message').textContent = error.message;
  }
}

async function saveAgentCustomer(event) {
  event.preventDefault();
  const { data } = await supabase.auth.getSession();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  byId('agent-customer-message').textContent = 'Creazione cliente in WooCommerce...';
  try {
    const response = await fetch('/api/agent-customers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: byId('agent-customer-name').value,
        company: byId('agent-customer-company').value,
        email: byId('agent-customer-email').value,
        phone: byId('agent-customer-phone').value,
        address1: byId('agent-customer-address').value,
        postcode: byId('agent-customer-postcode').value,
        city: byId('agent-customer-city').value,
        state: byId('agent-customer-state').value,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Creazione non riuscita');
    event.currentTarget.reset();
    event.currentTarget.classList.add('hidden');
    await loadAgentCustomers();
    byId('agent-customer-message').textContent = 'Cliente creato e collegato a WooCommerce.';
  } catch (error) {
    byId('agent-customer-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function handleAgentCustomerClick(event) {
  const button = event.target.closest('[data-agent-customer]');
  if (!button) return;
  selectedAgentCustomer = agentCustomers.find((item) => item.id === button.dataset.agentCustomer) || null;
  if (!selectedAgentCustomer) return;
  localStorage.setItem('odr-agent-customer', JSON.stringify(selectedAgentCustomer));
  fillShopAddress(selectedAgentCustomer.address || {});
  byId('shop-address-status').textContent = `Dati di ${selectedAgentCustomer.name}`;
  renderAgentCustomers();
  showRoute('shop', { push: true });
  byId('shop-message').classList.remove('hidden');
  byId('shop-message').textContent = `Stai creando un ordine per ${selectedAgentCustomer.name}.`;
}

function renderAdminUsers(users, wordpressAccounts = [], adminMembers = [], canManageAdmins = false) {
  const registeredRows = users
    .map((user) => {
      const membership = adminMembers.find((member) => member.profile_id === user.id);
      const wordpressAccount = wordpressAccounts.find((account) => (
        account.email.toLowerCase() === user.email.toLowerCase()
      ));
      const approvalRole = wordpressAccount?.mapped_role || user.requested_role;
      const pendingActions = user.approval_status === 'pending' ? `
        <button class="approve" type="button" data-user-action="approve" data-user-id="${user.id}">
          Approva come ${escapeHtml(roleLabels[approvalRole] || approvalRole)}
        </button>
        <button class="reject" type="button" data-user-action="reject" data-user-id="${user.id}">Rifiuta</button>
      ` : '';
      const adminActions = canManageAdmins && user.approval_status === 'approved'
        ? membership?.level === 'owner'
          ? '<span class="state ok">Titolare</span>'
          : user.role === 'admin'
            ? `
              <button class="reject" type="button" data-user-action="remove_admin" data-user-id="${user.id}">Rimuovi admin</button>
              <button class="delete" type="button" data-user-action="delete_user" data-user-id="${user.id}" data-user-label="${escapeHtml(user.full_name || user.email)}">Elimina account</button>
            `
            : `
              <select class="user-role-select" data-user-role="${user.id}" aria-label="Nuovo ruolo per ${escapeHtml(user.full_name || user.email)}">
                ${['patient', 'center', 'agent', 'distributor'].map((role) => (
    `<option value="${role}"${user.role === role ? ' selected' : ''}>${escapeHtml(roleLabels[role])}</option>`
  )).join('')}
              </select>
              <button class="role-change" type="button" data-user-action="change_role" data-user-id="${user.id}">Cambia ruolo</button>
              <button class="approve" type="button" data-user-action="promote_admin" data-user-id="${user.id}">Rendi amministratore</button>
              <button class="delete" type="button" data-user-action="delete_user" data-user-id="${user.id}" data-user-label="${escapeHtml(user.full_name || user.email)}">Elimina account</button>
            `
        : '';
      return `
      <tr>
        <td data-label="Utente">
          <strong>${escapeHtml(user.full_name || user.email)}</strong><br />
          <small>${escapeHtml(user.email)}${user.phone ? ` · ${escapeHtml(user.phone)}` : ''}</small>
        </td>
        <td data-label="Ruolo">
          ${escapeHtml(roleLabels[approvalRole] || approvalRole)}
          ${wordpressAccount ? '<br /><small>Account WordPress riconosciuto</small>' : ''}
        </td>
        <td data-label="Stato"><span class="state ${user.approval_status === 'approved' ? 'ok' : 'off'}">${escapeHtml(user.approval_status)}</span></td>
        <td data-label="Azioni">
          <div class="user-actions">
            ${pendingActions}
            ${adminActions}
            ${!pendingActions && !adminActions ? '-' : ''}
          </div>
        </td>
      </tr>
    `;
    })
    .join('');
  const importedRows = wordpressAccounts
    .filter((account) => !account.connected_profile_id)
    .map((account) => `
      <tr>
        <td data-label="Utente">
          <strong>${escapeHtml(account.full_name || account.email)}</strong><br />
          <small>${escapeHtml(account.email)} · WordPress #${account.wordpress_user_id}</small>
        </td>
        <td data-label="Ruolo">${escapeHtml(roleLabels[account.mapped_role] || account.mapped_role)}</td>
        <td data-label="Stato"><span class="state off">Da attivare</span></td>
        <td data-label="Azioni">Attende registrazione ODR</td>
      </tr>
    `)
    .join('');
  byId('admin-users-table').innerHTML = registeredRows + importedRows;

  const pending = users.filter((user) => user.approval_status === 'pending').length;
  const unlinked = wordpressAccounts.filter((account) => !account.connected_profile_id).length;
  byId('admin-users-message').textContent =
    `${pending} richieste in attesa · ${unlinked} account WordPress da collegare.`;
}

async function loadAdminUsers() {
  if (!supabase || currentUser?.role !== 'admin') return;
  byId('admin-users-message').textContent = 'Caricamento utenti...';
  const { data, error } = await supabase.functions.invoke('admin-users', {
    method: 'GET',
  });
  if (error || data?.error) {
    byId('admin-users-message').textContent = data?.error || 'Non è stato possibile caricare gli utenti.';
    return;
  }
  renderAdminUsers(
    data.users || [],
    data.wordpressAccounts || [],
    data.adminMembers || [],
    Boolean(data.canManageAdmins),
  );
}

async function handleAdminUserAction(event) {
  const button = event.target.closest('[data-user-action]');
  if (!button || currentUser?.role !== 'admin') return;
  const action = button.dataset.userAction;
  if (action === 'delete_user') {
    const confirmed = window.confirm(
      `Vuoi eliminare l’account app di ${button.dataset.userLabel}? L’account WordPress e gli ordini resteranno conservati.`,
    );
    if (!confirmed) return;
  }
  const roleSelect = byId('admin-users-table').querySelector(`[data-user-role="${button.dataset.userId}"]`);
  button.disabled = true;
  byId('admin-users-message').textContent = 'Aggiornamento del profilo...';
  const { data, error } = await supabase.functions.invoke('admin-users', {
    method: 'POST',
    body: {
      userId: button.dataset.userId,
      action,
      role: action === 'change_role' ? roleSelect?.value : undefined,
    },
  });
  if (error || data?.error) {
    byId('admin-users-message').textContent = data?.error || 'Aggiornamento non riuscito.';
    button.disabled = false;
    return;
  }
  await loadAdminUsers();
}

async function submitLogin(event) {
  event.preventDefault();
  if (authBusy || !supabase) return;

  setAuthBusy(true);
  showAuthMessage('Accesso in corso...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: byId('login-email').value.trim(),
    password: byId('login-password').value,
  });

  if (error) {
    const message = error.code === 'email_not_confirmed'
      ? 'Devi prima confermare l’email ricevuta dopo la registrazione.'
      : 'Email o password dell’app non corrette. La password WordPress non viene usata per accedere all’app.';
    showAuthMessage(message, 'error');
    setAuthBusy(false);
    return;
  }

  try {
    await enterAuthenticatedApp(data.user);
  } catch {
    showAuthMessage('Accesso riuscito, ma il profilo ODR non è ancora disponibile.', 'error');
  } finally {
    setAuthBusy(false);
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

  const email = byId('register-email').value.trim();
  const fullName = `${byId('register-name').value.trim()} ${byId('register-surname').value.trim()}`.trim();
  setAuthBusy(true);
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
  });

  if (error) {
    showAuthMessage(error.message || 'Non è stato possibile creare il profilo.', 'error');
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

async function submitLogout() {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
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
  const header = ['ordine', 'data', 'cliente', 'email', 'coupon', 'agente', 'distributore', 'centro', 'importo', 'stato'];
  const lines = filteredReportOrders.map((order) => [
    order.id,
    order.date,
    order.customer,
    order.customerEmail || '',
    order.coupon || '',
    order.agent || '',
    order.distributor || '',
    order.center || '',
    order.amount.toFixed(2),
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
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return;

  try {
    await enterAuthenticatedApp(data.session.user);
  } catch {
    await supabase.auth.signOut();
    showAuthMessage('La sessione non può essere associata a un profilo ODR.', 'error');
  }
}

byId('show-login').addEventListener('click', () => setAuthMode('login'));
byId('show-register').addEventListener('click', () => setAuthMode('register'));
byId('toggle-login-password').addEventListener('click', () => {
  const input = byId('login-password');
  const button = byId('toggle-login-password');
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.setAttribute('aria-label', reveal ? 'Nascondi password' : 'Mostra password');
  button.setAttribute('aria-pressed', String(reveal));
});
byId('login-form').addEventListener('submit', submitLogin);
byId('register-form').addEventListener('submit', submitRegistration);
byId('logout-button').addEventListener('click', submitLogout);
byId('refresh-users').addEventListener('click', loadAdminUsers);
byId('admin-users-table').addEventListener('click', handleAdminUserAction);
byId('new-agent-customer').addEventListener('click', () => byId('agent-customer-form').classList.remove('hidden'));
byId('cancel-agent-customer').addEventListener('click', () => byId('agent-customer-form').classList.add('hidden'));
byId('agent-customer-form').addEventListener('submit', saveAgentCustomer);
byId('agent-customer-list').addEventListener('click', handleAgentCustomerClick);
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
byId('shop-search').addEventListener('input', renderShopProducts);
byId('shop-products').addEventListener('click', (event) => {
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
byId('shop-cart-link').addEventListener('click', (event) => {
  event.preventDefault();
  setCartPanel(byId('shop-cart-panel').classList.contains('hidden'));
});
byId('shop-cart-close').addEventListener('click', () => setCartPanel(false));
byId('shop-continue-shopping').addEventListener('click', () => {
  setCartPanel(false);
  byId('shop-products').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
byId('shop-cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cart-action]');
  const item = event.target.closest('[data-cart-product]');
  if (!button || !item) return;
  updateShopCartItem(Number(item.dataset.cartProduct), button.dataset.cartAction);
});
byId('shop-checkout').addEventListener('click', (event) => {
  if (!shopCart.length) return;
  if (!validateShopAddress()) return;
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

initSupabaseStatus();
initRouting();
renderCodes();
renderPromotions();
renderNetwork();
renderOrders();
updateMetrics();
restoreSession();
