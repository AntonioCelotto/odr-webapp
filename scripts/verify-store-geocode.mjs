import assert from 'node:assert/strict';
import handler from '../api/store-geocode.js';
const original=globalThis.fetch;
let calls=[],role='admin',approved='approved',providerFails=false;
globalThis.fetch=async (url,options)=>{
 calls.push(String(url));
 if(String(url).includes('/auth/v1/user'))return {ok:true,json:async()=>({id:'test-id'})};
 if(String(url).includes('/profiles?'))return {ok:true,json:async()=>[{role,approval_status:approved}]};
 if(providerFails)throw Error('offline');
 assert.equal(options.headers.Authorization,undefined,'Never send login token to geocoder');
 return {ok:true,json:async()=>({features:[{geometry:{type:'Point',coordinates:[7.68,45.07]},properties:{street:'Via Roma',housenumber:'1',city:'Torino',country:'Italia'}},{geometry:{type:'Point',coordinates:[500,900]},properties:{name:'Invalid'}}]})};
};
async function run(headers={},body={},method='POST'){
 const result={};const res={status(s){result.status=s;},setHeader(){},send(s){result.body=JSON.parse(s);}};
 await handler({method,headers,body},res);return result;
}
try {
 assert.equal((await run()).status,403);assert.equal(calls.length,0);
 const headers={authorization:'Bearer test-only'};
 role='agent';assert.equal((await run(headers)).status,403);assert.equal(calls.length,2);
 role='admin';approved='rejected';assert.equal((await run(headers)).status,403);
 approved='approved';assert.equal((await run(headers)).status,400);
 const address={address:'Via Roma 1',postcode:'10100',city:'Torino',country:'Italia'};
 const r=await run(headers,address);assert.equal(r.status,200);assert.equal(r.body.results.length,1);assert.equal(r.body.results[0].latitude,45.07);assert.equal(r.body.results[0].longitude,7.68);
 const count=calls.length;assert.equal((await run(headers,address)).status,200);assert.equal(calls.length-count,2,'Cached result still checks authentication');
 assert.equal((await run(headers,{...address,address:'Via Roma 2'})).status,429);
 assert.equal((await run(headers,address,'GET')).status,405);
 console.log('PASS geocoding: admin authorization, rejected accounts, required address, no token leakage, coordinate order/bounds, caching, request throttling.');
}finally{globalThis.fetch=original;}
