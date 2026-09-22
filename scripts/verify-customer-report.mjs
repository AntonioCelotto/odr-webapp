import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import handler from '../api/admin-customers.js';
const html = readFileSync('index.html','utf8');
const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id]) => [id,{value:'',textContent:'',innerHTML:'',showModal(){this.open=true;}}]));
const context = vm.createContext({window:{location:{pathname:'/dashboard',hash:''}},document:{getElementById:id=>elements.get(id)},console});
vm.runInContext(readFileSync('app.js','utf8').replace(/^import .*\n/,'').split("byId('show-login').addEventListener")[0],context);
const run = code=>vm.runInContext(code,context);
const masters=[{id:'wc-1',name:'Cliente uno',email:'ONE@example.test'},{id:'app-a',name:'Cliente uno',email:'one@example.test',vatNumber:'123'},{id:'wc-2',name:'Senza ordini',email:'zero@example.test'},{id:'wc-3',email:'shared@example.test'},{id:'wc-4',email:'shared@example.test'}];
const a={id:'WC-1',customerId:1,customerEmail:'one@example.test',date:'2026-01-01',amount:132,taxAmount:22,shippingNetAmount:10,status:'completed'};
const orders=[a,{...a,id:'WC-2',customerReference:'app-a',date:'2026-03-31'},{...a,id:'WC-3',status:'cancelled'},a,{...a,id:'WC-4',customerId:0,customerEmail:'shared@example.test'}];
run(`const groups=buildCustomerReport(${JSON.stringify(masters)},${JSON.stringify(orders)});`);
assert.equal(run('groups.length'),5);
assert.equal(run('groups.find(c=>c.aliases.includes("wc-1")).orders.length'),3);
assert.equal(run('groups.find(c=>c.id==="wc-2").orders.length'),0);
assert.equal(run('groups.reduce((n,c)=>n+c.orders.length,0)'),4);
assert.equal(run('groups.find(c=>c.aliases.includes("wc-1")).vatNumber'),'123');
assert.equal(run(`customerPeriodOrders(groups.flatMap(c=>c.orders),'2026-01-01','2026-01-01').length`),2);
assert.equal(run(`customerPeriodOrders(groups.flatMap(c=>c.orders),'2026-03-31','2026-03-31').length`),1);
const series=JSON.parse(run(`JSON.stringify(customerMonthlySeries(customerPeriodOrders(groups[0].orders,'',''),'',''))`));
assert.deepEqual(series,[{label:'2026-01',value:100},{label:'2026-02',value:0},{label:'2026-03',value:100}]);
run(`currentUser={id:'admin',role:'admin'}; adminCustomerReport={userId:'admin',groups,warnings:[]};renderAdminCustomerReport();openCustomerTurnover(0);`);
assert.match(elements.get('customer-report-summary').textContent,/300,00/);
assert.match(elements.get('customer-report-table').innerHTML,/Senza ordini/);
assert.match(elements.get('dashboard-detail-content').innerHTML,/2026-02/);
elements.get('dashboard-detail-content').innerHTML='unchanged';
run(`currentUser={id:'agent',role:'agent'};openCustomerTurnover(0);`);
assert.equal(elements.get('dashboard-detail-content').innerHTML,'unchanged');
run(`currentUser={id:'admin',role:'admin'};`);
elements.get('customer-report-from').value='2026-04-01';elements.get('customer-report-to').value='2026-01-01';
run('renderAdminCustomerReport()');assert.match(elements.get('customer-report-message').textContent,/deve precedere/);

process.env.SUPABASE_URL='https://supabase.test';process.env.SUPABASE_PUBLISHABLE_KEY='test';process.env.WOOCOMMERCE_STORE_URL='https://woo.test';
let role='agent', appPages=0, wooPages=0, fail=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
 const url=String(input);
 if(url.includes('/auth/v1/user'))return Response.json({id:'user'});
 if(url.includes('/profiles?'))return Response.json([{role,approval_status:'approved'}]);
 assert.equal(role,'admin');
 if(url.includes('/agent_app_customers?')){appPages++;return Response.json(url.includes('offset=0')?Array.from({length:1000},(_,i)=>({id:i,name:'App cliente'})):[]);}
 if(url.includes('/customers?')){wooPages++;if(fail)return new Response('',{status:500});return Response.json(Array.from({length:100},(_,i)=>({id:i,name:'WC cliente'})),{headers:{'x-wp-totalpages':'1'}});}
 throw new Error('Unexpected fetch');
};
async function request(method='GET',authorization='Bearer test'){
 const result={statusCode:0,headers:{},status(n){this.statusCode=n;},setHeader(k,v){this.headers[k]=v;},send(body){this.body=JSON.parse(body);}};
 await handler({method,headers:{authorization}},result);return result;
}
try {
 assert.equal((await request()).statusCode,403);assert.equal(appPages,0);assert.equal(wooPages,0);
 role='distributor';assert.equal((await request()).statusCode,403);
 assert.equal((await request('POST')).statusCode,405);
 assert.equal((await request('GET','')).statusCode,403);
 role='admin';const response=await request();assert.equal(response.statusCode,200);assert.equal(response.body.customers.length,1100);assert.equal(appPages,2);assert.equal(wooPages,1);assert.equal(response.headers['Cache-Control'],'private, no-store');
 fail=true;assert.equal((await request()).statusCode,502);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS: clienti senza ordini, deduplica archivi/ordini, email ambigue, periodo inclusivo, mesi senza acquisti, imponibile coerente, dettaglio protetto, API solo admin, paginazione completa ed errori non mascherati.');
