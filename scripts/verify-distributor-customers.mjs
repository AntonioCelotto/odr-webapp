import assert from 'node:assert/strict';
import customers from '../api/agent-customers.js';
import order from '../api/agent-order.js';
process.env.SUPABASE_URL='https://database.test';
process.env.SUPABASE_PUBLISHABLE_KEY='test';
process.env.WOOCOMMERCE_STORE_URL='https://shop.test';
process.env.WOOCOMMERCE_CONSUMER_KEY='test';
process.env.WOOCOMMERCE_CONSUMER_SECRET='test';
let role='distributor', approval='approved', own=true, createdOrder;
const response=data=>({ok:true,json:async()=>data});
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.pathname==='/auth/v1/user')return response({id:'owner',email:'owner@example.test'});
 if(u.pathname==='/rest/v1/profiles')return response([{id:'owner',role,approval_status:approval,network_entity_id:'entity'}]);
 if(u.pathname==='/rest/v1/agent_app_customers'){
  if(options.method!=='POST')assert.equal(u.searchParams.get('agent_profile_id'),'eq.owner');
  if(options.method==='POST'){
   const body=JSON.parse(options.body);assert.equal(body.agent_profile_id,'owner');return response([{id:'customer',...body}]);
  }
  if(u.searchParams.has('email'))return response([]);
  if(options.method==='DELETE')return response(own?[{id:'customer'}]:[]);
  return response(own?[{id:'customer',name:'Test customer',email:'customer@example.test'}]:[]);
 }
 if(u.pathname==='/wp-json/wc/v3/orders' && options.method==='POST'){
  createdOrder=JSON.parse(options.body);return response({id:1,payment_url:'https://shop.test/pay'});
 }
 throw Error('Unexpected request '+u);
};
async function run(handler,method,body){const r={};await handler({method,headers:{authorization:'Bearer test'},body},{status(s){r.status=s},setHeader(){},send(v){r.body=JSON.parse(v)}});return r;}
assert.equal((await run(customers,'POST',{name:'Customer',email:'customer@example.test',agent_profile_id:'other'})).status,201);
assert.equal((await run(customers,'DELETE',{customerId:'app-customer'})).status,200);
own=false;assert.equal((await run(customers,'DELETE',{customerId:'app-customer'})).status,404);
assert.equal((await run(order,'POST',{customerId:'app-customer',items:[{productId:1,quantity:1}]})).status,502);assert.equal(createdOrder,undefined);
own=true;assert.equal((await run(order,'POST',{customerId:'app-customer',items:[{productId:1,quantity:1}]})).status,201);
assert.equal(createdOrder.created_via,'odr-distributor-app');assert.equal(createdOrder.meta_data.find(m=>m.key==='_odr_agent_entity_id').value,'entity');
role='patient';assert.equal((await run(customers,'POST',{})).status,403);assert.equal((await run(order,'POST',{})).status,403);
role='distributor';approval='pending';assert.equal((await run(customers,'POST',{})).status,403);
console.log('PASS distributor customer creation/deletion, ownership filters, own-customer checkout and attribution, blocked roles and pending profiles');
