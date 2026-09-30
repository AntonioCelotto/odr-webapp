import assert from 'node:assert/strict';
import handler from '../api/agent-customers.js';
process.env.SUPABASE_URL='https://test.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='test';
const original=globalThis.fetch; let writes=0;
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('/auth/')) return Response.json({id:'actor',email:'actor@example.invalid'});
 if(String(url).includes('/profiles')) return Response.json([{id:'actor',role:'agent',approval_status:'approved'}]);
 if(options.method==='POST'){writes++;return Response.json([{id:'customer'}]);}
 return Response.json([]);
};
const base={name:'Centro',email:'test@example.invalid',company:'Azienda',phone:'123',address1:'Via Test',postcode:'10100',city:'Torino',state:'TO',vatNumber:'12345678901',sdiCode:'ABC1234'};
async function call(body){let status;await handler({method:'POST',headers:{authorization:'Bearer test'},body},{status(n){status=n},setHeader(){},send(){}});return status;}
assert.equal(await call({...base,soleTrader:true}),400);
assert.equal(await call({...base,sdiCode:''}),400);
assert.equal(await call({...base,vatNumber:''}),400);
assert.equal(await call({...base,pec:'bad'}),400);
assert.equal(await call({...base,storeRequested:true,storeCategory:'invalid'}),400);
assert.equal(await call({...base,taxCode:'A'.repeat(17)}),400);
assert.equal(await call({...base,vatNumber:'123456789012'}),400);
assert.equal(await call({...base,vatNumber:'1234567890A'}),400);
assert.equal(writes,0);
assert.equal(await call(base),201);
assert.equal(await call({...base,sdiCode:'',pec:'pec@example.invalid'}),201);
assert.equal(await call({...base,soleTrader:true,taxCode:'RSSMRA80A01L219X',pec:'pec@example.invalid',storeRequested:true,storeCategory:'hair'}),201);
assert.equal(writes,3);globalThis.fetch=original;
console.log('Fiscal validation: missing CF, VAT, PEC/SDI rejected; PEC only, SDI only, both accepted.');
