import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('app.js', 'utf8').replace(/^import .*\n/, '').split("byId('show-login').addEventListener")[0];
const html = readFileSync('index.html','utf8');
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id, {value:'', textContent:'', innerHTML:'', selectedOptions:[{textContent:'Tutto il periodo'}], showModal(){this.open=true;}}]));
const context = vm.createContext({window:{location:{pathname:'/dashboard',hash:''}}, document:{getElementById(id){assert(elements.has(id), `Missing DOM element ${id}`); return elements.get(id);}}, console});
vm.runInContext(source, context);
const run = code => vm.runInContext(code,context);
const content = id => elements.get(id).innerHTML.replaceAll('\u00a0',' ');
const text = id => String(elements.get(id).textContent).replaceAll('\u00a0',' ');
const date = new Date().toISOString().slice(0,10);
const order = {id:'WC-1',date,customer:'Cliente A',customerEmail:'a@example.test',amount:134.2,taxAmount:24.2,shippingNetAmount:10,shippingAmount:10,status:'pending',agent:'Agente A',agentEntityId:'a',shippingState:'TO',coupon:'PROMO',items:[{name:'Pacchetto promo',productId:1,quantity:2,total:100,taxAmount:22}]};
const second = {...order,id:'WC-2',amount:110,taxAmount:10,shippingNetAmount:0,status:'processing',agent:'',distributor:'Distributore B',shippingState:'RM',items:[{name:'Crema',productId:2,quantity:1,total:100,taxAmount:10}]};
const cancelled = {...order,id:'WC-3',status:'cancelled',amount:9999};
elements.get('admin-dashboard-period').value='all';
run(`reportOrders=${JSON.stringify([order,second,cancelled])};`);
for (const role of ['admin','agent','distributor']) {
 run(`currentUser={role:'${role}'}; renderAdminDashboard();`);
 assert.equal(text('admin-kpi-revenue'),'200,00 €');
 assert.equal(text('admin-kpi-revenue-taxable'),'Totale lordo 244,20 €');
 assert.equal(text('admin-kpi-agent-revenue'),'100,00 €');
 assert.equal(text('admin-kpi-distributor-revenue'),'100,00 €');
 assert.match(content('admin-kpi-pending-detail'), /<b>Imponibile 100,00 €<\/b>/);
 assert.match(content('admin-kpi-working-detail'), /<b>Imponibile 100,00 €<\/b>/);
 assert.match(content('admin-italy-chart'), /50%/);
 assert.match(content('admin-sales-chart'), /Imponibile: 200,00 € · Totale lordo: 244,20 €/);
 assert.match(content('admin-promotions-chart'), /2 pz/);
 assert(!content('admin-products-chart').includes('Pacchetto promo'));
 for(const id of ['admin-products-chart','admin-category-chart','admin-promotions-chart']) assert(!content(id).includes('€'));
 assert.match(text('admin-channel-total'),role==='admin'?/Imponibile canali 200,00 €/:/Imponibile clienti 200,00 €/);
 assert.equal(elements.get('dashboard-network-channels').hidden,role!=='admin');
 assert.equal(elements.get('dashboard-customer-channels').hidden,role==='admin');
 assert.equal(text('dashboard-channel-title'),role==='admin'?'Agenti e distributori':'I miei clienti');
 if(role!=='admin') { assert.match(content('dashboard-customer-channels'),/Cliente A/); assert.match(content('dashboard-customer-channels'),/200,00 €/); }
 for(const type of ['pending','working','total-revenue','agent-revenue','distributor-revenue','category-sales','promotion-sales','product-sales','channel-sales','customers','repeat-customers']) {
  run(`openDashboardDetail('${type}')`);
  if (['category-sales','promotion-sales','product-sales'].includes(type)) {
   assert.match(content('dashboard-detail-content'), /Pezzi venduti/);
   assert(!content('dashboard-detail-content').includes('€'));
   if(type==='product-sales') assert(!content('dashboard-detail-content').includes('Pacchetto promo'));
  } else {
   assert.match(content('dashboard-detail-content'), /Imponibile/, `${role}/${type}`);
   assert.match(content('dashboard-detail-content'), /lordo/, `${role}/${type}`);
  }
  assert(!content('dashboard-detail-content').includes('NaN'));
 }
}
run(`reportOrders=${JSON.stringify([order])}; openDashboardDetail('new-customers'); renderOrders();`);
assert.match(content('dashboard-detail-content'), /<strong>100,00 €<\/strong>/);
assert.match(content('dashboard-detail-content'), /<small>134,20 €<\/small>/);
assert.match(content('orders-table'), /Imponibile.*<strong>100,00 €<\/strong>/);
assert.match(content('report-summary'), /Imponibile vendite<\/span><strong>100,00 €/);
assert.match(content('report-summary'), /Totale lordo 134,20 €/);
assert.equal(run(`dashboardOrderTaxable({amount:134.2,taxAmount:24.2,shippingNetAmount:10})`),100);
assert.equal(run(`dashboardOrderTaxable({amount:0,taxAmount:0,shippingNetAmount:0,commissionBase:0})`),0);
run(`reportOrders=[]; renderAdminDashboard(); renderOrders();`);
assert.equal(text('admin-kpi-revenue'),'0,00 €');
assert(!content('admin-sales-chart').includes('NaN'));
console.log('PASS: 3 ruoli; 12 dettagli; IVA e trasporto netto; grafici, canali, prodotti; ordini esclusi; riepilogo Ordini; stato vuoto.');

run(`orderAssignmentOptions=[{id:'a',type:'agent',name:'Agente A'},{id:'d',type:'distributor',name:'Distributore D'}];`);
for(const role of ['admin','agent','distributor']) {
 run(`currentUser={role:'${role}'}; reportOrders=${JSON.stringify([order])}; renderOrders();`);
 const table=content('orders-table');
 assert.equal(table.includes('Salva associazione'),role==='admin');
 if(role==='admin') {
  assert.match(table,/Associa questo ordine/);
  assert.match(table,/Agente A/);
  assert.match(table,/Distributore D/);
 }
}
console.log('PASS: menu associazione visibile solo all’amministratore; agenti e distributori selezionabili.');
