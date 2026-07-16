const config = {
  supabaseUrl: '',
  supabasePublishableKey: '',
  wooBaseUrl: 'https://example.com',
  wooShopPath: '/shop',
  defaultValidationCode: 'ODR-DEMO',
};

const roleLabels = {
  admin: 'Amministratore',
  distributor: 'Distributore',
  agent: 'Agente',
  center: 'Centro / punto vendita',
  patient: 'Paziente',
};

const validationCodes = [
  {
    code: config.defaultValidationCode,
    label: 'Convenzione demo paziente',
    hospital: 'Ospedale convenzionato',
    discountLabel: 'Accesso prodotti convenzionati',
    coupon: 'ODR10',
    active: true,
    uses: 18,
  },
  {
    code: 'HOSP-LILLA-25',
    label: 'Campagna reparto dermatologia',
    hospital: 'Ospedale San Luca',
    discountLabel: 'Coupon paziente 25%',
    coupon: 'LILLA25',
    active: true,
    uses: 42,
  },
  {
    code: 'ODR-BIRTHDAY',
    label: 'Coupon compleanno',
    discountLabel: 'Omaggio fidelity',
    coupon: 'AUGURIODR',
    active: false,
    uses: 7,
  },
];

let networkRows = [
  {
    id: 'dist-nord',
    type: 'distributor',
    name: 'Distribuzione Nord',
    email: 'nord@example.com',
    phone: '+39 011 000000',
    area: 'Nord Ovest',
    parentName: '',
    active: true,
  },
  {
    id: 'agent-rossi',
    type: 'agent',
    name: 'Laura Rossi',
    email: 'laura.rossi@example.com',
    phone: '',
    area: 'Piemonte',
    parentName: 'Distribuzione Nord',
    active: true,
  },
  {
    id: 'center-aurora',
    type: 'center',
    name: 'Centro Aurora',
    email: 'info@centroaurora.example',
    phone: '',
    area: 'Torino',
    parentName: 'Laura Rossi',
    active: true,
  },
  {
    id: 'dist-centro',
    type: 'distributor',
    name: 'Distribuzione Centro',
    email: 'centro@example.com',
    phone: '',
    area: 'Centro Italia',
    parentName: '',
    active: true,
  },
];

const reportOrders = [
  {
    id: 'WC-1024',
    date: '2026-07-08',
    customer: 'Paziente convenzionato',
    amount: 148.6,
    coupon: 'ODR10',
    agent: 'Laura Rossi',
    distributor: 'Distribuzione Nord',
    status: 'completed',
  },
  {
    id: 'WC-1028',
    date: '2026-07-11',
    customer: 'Centro Aurora',
    amount: 612.9,
    coupon: 'LILLA25',
    agent: 'Laura Rossi',
    distributor: 'Distribuzione Nord',
    status: 'paid',
  },
  {
    id: 'WC-1031',
    date: '2026-07-14',
    customer: 'Punto vendita Demo',
    amount: 284.2,
    coupon: 'ODR10',
    agent: 'Marco Bianchi',
    distributor: 'Distribuzione Centro',
    status: 'processing',
  },
];

let validatedCode = null;

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function buildShopUrl(code) {
  const url = new URL(config.wooShopPath, config.wooBaseUrl);
  if (code?.coupon) url.searchParams.set('coupon', code.coupon);
  if (code?.code) url.searchParams.set('odr_code', code.code);
  return url.toString();
}

function updateMetrics() {
  const revenue = reportOrders.reduce((sum, order) => sum + order.amount, 0);
  byId('metric-revenue').textContent = money(revenue);
  byId('metric-codes').textContent = validationCodes.filter((code) => code.active).length;
  byId('metric-network').textContent = networkRows.filter((row) => row.active).length;
  byId('metric-role').textContent = roleLabels[byId('role').value] || 'Utente';
  byId('metric-email').textContent = byId('account-email').value;
  byId('shop-link').href = buildShopUrl(validatedCode);
  byId('wp-base-url').textContent = config.wooBaseUrl;
}

function renderCodes() {
  byId('code-list').innerHTML = validationCodes
    .map((code) => `
      <div class="list-row">
        <div>
          <strong>${code.code}</strong>
          <span>${code.label}</span>
        </div>
        <em class="state ${code.active ? 'ok' : 'off'}">${code.active ? 'Attivo' : 'Spento'}</em>
      </div>
    `)
    .join('');
}

function renderNetwork() {
  const query = byId('network-search').value.trim().toLowerCase();
  const rows = networkRows.filter((row) => {
    if (!query) return true;
    return [row.type, row.name, row.email, row.phone, row.area, row.parentName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  byId('network-table').innerHTML = rows
    .map((row) => `
      <tr>
        <td>${row.type}</td>
        <td>${row.name}</td>
        <td>${row.area || '-'}</td>
        <td>${row.parentName || '-'}</td>
        <td>${row.email || row.phone || '-'}</td>
        <td><span class="state ok">Attivo</span></td>
      </tr>
    `)
    .join('');
}

function renderOrders() {
  byId('orders-table').innerHTML = reportOrders
    .map((order) => `
      <tr>
        <td>${order.id}</td>
        <td>${order.date}</td>
        <td>${order.customer}</td>
        <td>${order.coupon || '-'}</td>
        <td>${order.agent || '-'}</td>
        <td>${order.distributor || '-'}</td>
        <td>${money(order.amount)}</td>
        <td><span class="state ok">${order.status}</span></td>
      </tr>
    `)
    .join('');
}

function validateCode() {
  const input = byId('code-input').value.trim().toLowerCase();
  const found = validationCodes.find((code) => code.active && code.code.toLowerCase() === input);
  validatedCode = found || null;

  if (!found) {
    byId('code-result').className = 'empty-box';
    byId('code-result').innerHTML = '<span>Codice non valido o non attivo.</span>';
    updateMetrics();
    return;
  }

  byId('code-result').className = 'success-box';
  byId('code-result').innerHTML = `
    <div>
      <strong>${found.label}</strong>
      <span>${found.discountLabel} - coupon ${found.coupon}</span>
      <a href="${buildShopUrl(found)}" target="_blank" rel="noreferrer">Vai allo shop WordPress</a>
    </div>
  `;
  updateMetrics();
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

function importNetworkFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(String(reader.result || ''));
    networkRows = [...rows, ...networkRows];
    byId('import-notice').textContent = `${rows.length} righe importate da ${file.name}`;
    renderNetwork();
    updateMetrics();
  };
  reader.readAsText(file);
}

function exportReport() {
  const header = ['ordine', 'data', 'cliente', 'coupon', 'agente', 'distributore', 'importo', 'stato'];
  const lines = reportOrders.map((order) => [
    order.id,
    order.date,
    order.customer,
    order.coupon || '',
    order.agent || '',
    order.distributor || '',
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
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  byId('supabase-dot').className = configured ? 'dot ok' : 'dot warn';
  byId('supabase-status').textContent = configured ? 'Supabase collegato' : 'Modalita demo';
  byId('supabase-pill').className = configured ? 'config-pill ok' : 'config-pill warn';
  byId('supabase-pill').textContent = configured ? 'Configurato' : 'Configura env';
}

byId('validate-code').addEventListener('click', validateCode);
byId('role').addEventListener('change', updateMetrics);
byId('account-email').addEventListener('input', updateMetrics);
byId('network-search').addEventListener('input', renderNetwork);
byId('network-import').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importNetworkFile(file);
});
byId('export-report').addEventListener('click', exportReport);

initSupabaseStatus();
renderCodes();
renderNetwork();
renderOrders();
updateMetrics();
