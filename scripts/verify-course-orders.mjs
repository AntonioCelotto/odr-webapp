import assert from 'node:assert/strict';
import handler from '../api/orders.js';
import { trainingOrderItems, availableBatches } from '../course-orders.js';
import { mountCourseAssignments } from '../course-assignments.js';

assert.equal(trainingOrderItems({items:[{sku:' odr1 ',productId:1,name:'Corso'}]}).length,1);
assert.equal(trainingOrderItems({items:[{sku:'ODR11',productId:2,name:'Altro corso'}]}).length,0);
assert.equal(trainingOrderItems({items:[{productId:3,name:'Corso storico'}]},[{id:3,sku:'ODR1'}]).length,1);
assert.equal(trainingOrderItems({items:[{productId:4,name:' VIDEO CORSO DI FORMAZIONE '}]}).length,1);
const courses=[{id:'course',title:'Corso',active:true}];
const accesses=[1,2].map(n=>({id:'a'+n,owner_id:'owner',course_id:'course',source_order:'WC-'+n,product_id:1,active:true}));
assert.equal(availableBatches(accesses,courses).length,2,'Different purchases must stay separate');
assert.equal(availableBatches([...accesses,{...accesses[0],recipient_email:'assigned@example.test'},{...accesses[0],active:false}],courses).flat().length,2);

const originalFetch=globalThis.fetch;
const savedEnv={...process.env};
const rawOrders=[
 {id:101,number:'ODR-101',status:'processing',billing:{first_name:'Anna',last_name:'Rossi',company:'Centro Anna',email:'own@example.test',phone:'123'},line_items:[{product_id:1,sku:'ODR1',name:'VIDEO CORSO DI FORMAZIONE',quantity:2}]},
 {id:102,status:'processing',billing:{email:'someone-else@example.test',company:'Other private client'},line_items:[{product_id:1,sku:'ODR1',quantity:1}]},
];
let role='agent',calls=0;
globalThis.fetch=async input=>{
 calls++;const url=new URL(input);
 const value=url.pathname==='/auth/v1/user'?{id:'owner',email:'own@example.test'}
 :url.pathname==='/rest/v1/profiles'?[{id:'owner',role,approval_status:'approved'}]
 :url.pathname==='/functions/v1/network-management'?{entities:[],accounts:[]}
 :url.pathname==='/wp-json/wc/v3/orders'?rawOrders:[];
 return new Response(JSON.stringify(value),{status:200});
};
process.env.SUPABASE_URL='https://supabase.example.test';
process.env.SUPABASE_PUBLISHABLE_KEY='test-public';
process.env.WOOCOMMERCE_STORE_URL='https://woo.example.test';
let status,body;
const response={status(v){status=v;return this;},setHeader(){},send(v){body=JSON.parse(v);}};
try {
 await handler({method:'GET',headers:{}},response);assert.equal(status,403);assert.equal(calls,0);
 await handler({method:'GET',headers:{authorization:'Bearer mocked-test-token'}},response);
 assert.equal(status,200);assert.equal(body.orders.length,1,'Agent cannot see another customer’s purchase');
 assert.equal(body.orders[0].number,'ODR-101');assert.equal(body.orders[0].customerCompany,'Centro Anna');
 assert.equal(body.orders[0].customerPhone,'123');assert.equal(body.orders[0].items[0].sku,'ODR1');
 role='admin';await handler({method:'GET',headers:{authorization:'Bearer mocked-test-token'}},response);assert.equal(body.orders.length,2);
 const projected=body.orders;
 const root={innerHTML:'',textContent:'',querySelector:()=>null,querySelectorAll:()=>[]};
 globalThis.fetch=async input=>{
  const url=String(input);
  const value=url.includes('/course-management')?{courses,accesses:[accesses[0]],owners:[],mappings:[],canManage:false}
   :url==='/api/orders'?{orders:projected}:url==='/api/catalog'?{products:[]}:{customers:[]};
  return new Response(JSON.stringify(value));
 };
 const supabase={supabaseUrl:'https://supabase.example.test',supabaseKey:'test-public',auth:{getSession:async()=>({data:{session:{access_token:'mocked-test-token'}}})}};
 await mountCourseAssignments(root,supabase,{});
 assert(root.innerHTML.includes('ODR-101'));assert(root.innerHTML.includes('Centro Anna'));assert(root.innerHTML.includes('Video da collegare'));
 assert(root.innerHTML.includes('Codice ordine'));assert(root.innerHTML.includes('Cliente dell’ordine'));
 // A failed request must be reported, never rendered as an empty, successful search.
 globalThis.fetch=async input=>new Response(JSON.stringify(String(input)==='/api/orders'?{error:'Ordini non disponibili'}:{courses:[],accesses:[],owners:[],mappings:[],canManage:false}),{status:String(input)==='/api/orders'?502:200});
 await mountCourseAssignments(root,supabase,{});assert(root.innerHTML.includes('role="alert"'));assert(!root.innerHTML.includes('0 ordini trovati'));
 console.log('ODR1 recognition, legacy orders, order batches, customer data, scoped API visibility, anonymous denial and UI error states OK');
} finally {globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in savedEnv))delete process.env[k];Object.assign(process.env,savedEnv);}
