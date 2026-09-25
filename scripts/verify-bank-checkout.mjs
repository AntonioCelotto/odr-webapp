import assert from 'node:assert/strict';
import handler, { validateItems, address } from '../api/bank-checkout.js';
assert.deepEqual(validateItems([{productId:1,quantity:2}]),[{product_id:1,quantity:2}]);
for (const items of [[], [{productId:1,quantity:1.5}], [{productId:1,quantity:100}], [{productId:1,quantity:1},{productId:1,quantity:2}]]) assert.throws(()=>validateItems(items));
const delivery = {firstName:'Anna',lastName:'Test',address1:'Via Roma 1',postcode:'10100',city:'Torino',state:'to',country:'it',phone:'123'};
assert.equal(address(delivery,'verified@example.test').email,'verified@example.test');
assert.throws(()=>address({...delivery,postcode:'abc'},'a@b.it'));
process.env.SUPABASE_URL='https://auth.example.test';
process.env.SUPABASE_PUBLISHABLE_KEY='public';
process.env.WOOCOMMERCE_STORE_URL='https://shop.example.test';
const originalFetch=globalThis.fetch;
let calls=[];
let role='center'; let approved='approved'; let upstream;
globalThis.fetch=async (url,options={})=>{
  calls.push(String(url));
  if(String(url).endsWith('/auth/v1/user')) return Response.json({id:'verified-user',email:'verified@example.test'});
  if(String(url).includes('/rest/v1/profiles')) return Response.json([{id:'verified-user',role,approval_status:approved}]);
  if(String(url).includes('/promo-codes')) return Response.json({activeCode:null});
  if(String(url).includes('/bank-checkout')) {upstream=JSON.parse(options.body);return Response.json({quoteToken:'a'.repeat(64),total:'100.00'});}
  throw Error('Unexpected request '+url);
};
async function call(body,authorization='Bearer test') {
 let status,data;
 await handler({method:'POST',headers:{authorization},body},{status(n){status=n;},setHeader(){},send(s){data=JSON.parse(s);}});
 return {status,data};
}
assert.equal((await call({},'')).status,401);
role='patient'; assert.equal((await call({action:'quote'})).status,403);
role='center'; approved='rejected'; assert.equal((await call({action:'quote'})).status,403);
approved='approved'; assert.equal((await call({action:'quote',customerId:'wc-9'})).status,403);
role='agent'; assert.equal((await call({action:'quote'})).status,400);
role='center'; assert.equal((await call({action:'quote',items:[{productId:1,quantity:2}],address:delivery,coupon:'SAVE',role:'admin',actor_id:'attacker',total:1})).status,200);
assert.equal(upstream.actor_id,'verified-user'); assert.equal(upstream.role,'center'); assert.equal(upstream.customer_email,'verified@example.test'); assert.equal(upstream.total,undefined);
assert.equal((await call({action:'confirm',quoteToken:'bad'})).status,400);
await call({action:'confirm',quoteToken:'b'.repeat(64),items:[{productId:99,quantity:5}],total:1});
assert.equal(upstream.items,undefined);assert.equal(upstream.quote_token,'b'.repeat(64));assert.equal(upstream.actor_id,'verified-user');
globalThis.fetch=originalFetch;
console.log('Bank checkout: authentication, roles, quantities, address, trusted identity and confirm payload verified.');
