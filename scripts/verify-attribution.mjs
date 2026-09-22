import assert from 'node:assert/strict';
import {createAttributionIndex,assignmentKey} from '../api/_order-attribution.js';
import handler from '../api/orders.js';
import customersHandler from '../api/agent-customers.js';
const network=[
 {id:'a',type:'agent',name:'Agente A',email:'a@example.test',external_code:'WP-30',parent_id:'d',active:true,commission_rate:.2},
 {id:'b',type:'agent',name:'Agente B',email:'b@example.test',external_code:'WP-31',active:true,commission_rate:.1},
 {id:'d',type:'distributor',name:'Distributore',active:true},
];
const profiles=[{id:'pa',email:'a@example.test',role:'agent',network_entity_id:'a',wordpress_user_id:30},{id:'pb',email:'b@example.test',role:'agent',network_entity_id:'b',wordpress_user_id:31}];
const index=createAttributionIndex(network,profiles,[],[{id:'c',email:'app@example.test',agent_profile_id:'pa',active:true}]);
index.addCustomer(101,'customer@example.test',network[0]);
let order={id:1,customer_id:101,billing:{email:'customer@example.test'},meta_data:[]};
assert.equal(index.resolve(order).agent.id,'a');
assert.equal(index.resolve({...order,meta_data:[{key:'_odr_agent_entity_id',value:'outside-scope'}]}).conflict,true);
assert.equal(index.resolve(order).distributor.id,'d');
assert(index.visible(order,profiles[0],index.resolve(order)));
assert(!index.visible(order,profiles[1],index.resolve(order)));
assert(index.visible(order,{role:'distributor',network_entity_id:'d'},index.resolve(order)));
order.meta_data=[{key:assignmentKey,value:{mode:'manual',entityId:'b'}}];
assert.equal(index.resolve(order).agent.id,'b');
assert.equal(index.resolve(order).distributor,null);
assert(!index.visible(order,profiles[0],index.resolve(order)));
assert(index.visible(order,profiles[1],index.resolve(order)));
order.meta_data[0].value.entityId='d';
assert.equal(index.resolve(order).agent,null);
assert.equal(index.resolve(order).distributor.id,'d');
order.meta_data[0].value.mode='automatic';
assert.equal(index.resolve(order).agent.id,'a');
index.addCustomer(101,'customer@example.test',network[1]);
assert.equal(index.resolve(order).conflict,true);
assert.equal(index.resolve(order).agent,null);
assert(!index.visible(order,profiles[0],index.resolve(order)));
order.meta_data=[{key:'_odr_agent_profile_id',value:'pa'}];
assert.equal(index.resolve(order).agent.id,'a');
assert.equal(index.resolve({billing:{email:'app@example.test'}}).agent.id,'a');
index.addWooCustomer({id:202,email:'new@example.test',meta_data:[{key:'agente_email',value:'b@example.test'}]});
assert.equal(index.resolve({customer_id:202}).agent.id,'b');
assert.equal(index.resolve({meta_data:[{key:assignmentKey,value:{mode:'manual',entityId:'deleted'}}]}).conflict,true);

// Request-level authorization and persistence: simulate WooCommerce metadata round trips.
process.env.SUPABASE_URL='https://database.example.test';
process.env.SUPABASE_PUBLISHABLE_KEY='public-fixture';
process.env.WOOCOMMERCE_CONSUMER_KEY='fixture-key';
process.env.WOOCOMMERCE_CONSUMER_SECRET='fixture-secret';
process.env.WOOCOMMERCE_STORE_URL='https://shop.example.test';
let role='agent'; let writes=0; let stored={id:1,meta_data:[],total:'122',status:'completed'};
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,opts={})=>{
 const url=String(input);
 const ok=data=>({ok:true,status:200,json:async()=>data});
 if(url.includes('/auth/v1/user'))return ok({id:'pa',email:'a@example.test'});
 if(url.includes('/rest/v1/profiles?'))return ok([{id:'pa',role,approval_status:'approved'}]);
 if(url.includes('/functions/v1/network-management'))return ok({entities:network});
 if(url.endsWith('/orders/1')) {
  if(opts.method==='PUT') {
   writes++;
   const body=JSON.parse(opts.body);
   assert.deepEqual(Object.keys(body),['meta_data']);
   stored={...stored,meta_data:body.meta_data};
  }
  return ok(stored);
 }
 throw Error(`Unexpected request ${url}`);
};
async function call(body,method='PATCH',endpoint=handler) {
 let status,payload;
 await endpoint({method,headers:{authorization:'Bearer fixture'},body},{status(s){status=s;},setHeader(){},send(s){payload=JSON.parse(s);}});
 return {status,payload};
}
assert.equal((await call({orderId:1,mode:'manual',entityId:'b'})).status,403);
assert.equal(writes,0);
role='admin';
assert.equal((await call({orderId:1,mode:'manual',entityId:'missing'})).status,400);
assert.equal(writes,0);
assert.equal((await call({orderId:1,mode:'manual',entityId:'b'})).status,200);
assert.equal(index.resolve({...order,meta_data:stored.meta_data}).agent.id,'b');
assert.equal(stored.total,'122');
assert.equal((await call({orderId:1,mode:'manual',entityId:'d'})).status,200);
assert.equal(index.resolve({...order,meta_data:stored.meta_data}).distributor.id,'d');
assert.equal((await call({orderId:1,mode:'automatic'})).status,200);
assert.equal(stored.meta_data[0].value.mode,'automatic');
assert.equal((await call({orderId:'../2',mode:'manual',entityId:'a'})).status,400);
globalThis.fetch=originalFetch;
console.log('PASS: automatico WordPress/email/app; precedenza manuale; ripristino; conflitti; isolamento agenti/distributori; PATCH solo admin; salvataggio e rilettura metadata; importi invariati.');
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const fixtureOrder={id:10,customer_id:101,billing:{email:'customer@example.test',first_name:'Cliente'},date_created:'2026-09-01T12:00:00',date_paid:'2026-09-02T12:00:00',total:'134.20',total_tax:'24.20',shipping_total:'10',status:'completed',line_items:[{name:'Prodotto',quantity:1,total:'100',total_tax:'22'}],meta_data:[]};
let reader={...profiles[0],approval_status:'approved'};
globalThis.fetch=async (input,options={})=>{
 const url=new URL(String(input));
 const ok=data=>({ok:true,status:200,json:async()=>data});
 if(url.pathname==='/auth/v1/user')return ok({id:reader.id,email:reader.email});
 if(url.pathname==='/rest/v1/profiles' && url.searchParams.has('id'))return ok([reader]);
 if(url.hostname==='database.example.test') assert.equal(options.headers.Authorization,'Bearer fixture');
 if(url.pathname==='/functions/v1/network-management')return ok({entities:reader.role==='admin'?network:reader.network_entity_id==='b'?[network[1]]:[network[0],network[2]],accounts:reader.role==='admin'?profiles:[]});
 if(url.pathname==='/rest/v1/profiles')return ok(reader.role==='admin'?profiles:[reader]);
 if(url.pathname==='/rest/v1/network_entities')return ok(network);
 if(url.pathname==='/rest/v1/wordpress_accounts')return ok([]);
 if(url.pathname==='/rest/v1/agent_app_customers')return ok([]);
 if(url.pathname==='/rest/v1/order_payment_entries')return ok([]);
 if(url.pathname==='/wp-json/wc/v3/odr-agent-customers')return ok({customers:url.searchParams.get('agent_id')==='30'?[{id:101,email:'customer@example.test'}]:[]});
 if(url.pathname==='/wp-json/wc/v3/customers')return ok([]);
 if(url.pathname==='/wp-json/wc/v3/orders')return ok([fixtureOrder]);
 throw Error(`Unexpected GET ${url.pathname}`);
};
let result=await call(null,'GET');
assert.equal(result.status,200);
assert.equal(result.payload.orders[0].agent,'Agente A');
assert.equal(result.payload.orders[0].agentEarning,20);
assert.equal(result.payload.orders[0].amount,134.2);
assert.deepEqual(result.payload.assignmentOptions,[]);
reader={id:'admin',email:'admin@example.test',role:'admin',approval_status:'approved'};
result=await call(null,'GET');
assert.equal(result.payload.orders[0].agent,'Agente A');
assert.equal(result.payload.assignmentOptions.length,3);
fixtureOrder.meta_data=[{key:assignmentKey,value:{mode:'manual',entityId:'b'}}];
reader={...profiles[0],approval_status:'approved'};
assert.equal((await call(null,'GET')).payload.orders.length,0);
reader={...profiles[1],approval_status:'approved'};
result=await call(null,'GET');
assert.equal(result.payload.orders[0].agentEarning,10);
assert.equal(result.payload.orders[0].agent,'Agente B');
// Reproduce the production configuration: the privileged key is absent throughout.
assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY,undefined);
reader={id:'pd',email:'distributor@example.test',role:'distributor',network_entity_id:'d',approval_status:'approved'};
assert.equal((await call(null,'GET')).payload.orders.length,0);
fixtureOrder.meta_data=[];
result=await call(null,'GET');
assert.equal(result.status,200);
assert.equal(result.payload.orders[0].agent,'Agente A');
assert.equal(result.payload.orders[0].distributor,'Distributore');
assert.deepEqual(result.payload.assignmentOptions,[]);
assert.equal((await call({orderId:10,mode:'manual',entityId:'a'})).status,403);
fixtureOrder.meta_data=[{key:assignmentKey,value:{mode:'manual',entityId:'d'}}];
result=await call(null,'GET');
assert.equal(result.payload.orders[0].distributor,'Distributore');
assert.equal(result.payload.orders[0].agent,'');
assert.equal(result.payload.orders[0].agentEarning,0);
reader={...profiles[0],approval_status:'approved'};
assert.equal((await call(null,'GET')).payload.orders.length,0);
fixtureOrder.meta_data=[];
result=await call(null,'GET',customersHandler);
assert.equal(result.status,200);
assert(result.payload.customers.some(customer=>customer.orders.length===1));
fixtureOrder.meta_data=[{key:assignmentKey,value:{mode:'manual',entityId:'b'}}];
result=await call(null,'GET',customersHandler);
assert.equal(result.status,200);
assert(result.payload.customers.every(customer=>customer.orders.length===0));
reader={...profiles[1],approval_status:'approved'};
result=await call(null,'GET',customersHandler);
assert.equal(result.status,200);
assert(result.payload.customers.some(customer=>customer.orders.length===1));
globalThis.fetch=originalFetch;
console.log('PASS: nessuna chiave privilegiata; dati rete limitati per ruolo; distributore automatico e manuale; storico clienti coerente.');
console.log('PASS: GET completo con fonte WordPress; report admin/agente coerenti; riassegnazione rimuove accesso precedente e aggiorna provvigioni.');
