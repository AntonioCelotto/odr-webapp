import assert from 'node:assert/strict';
import {prepareAlignment,AlignmentError} from '../supabase/functions/voucher-management/manual.js';

const owner={id:'agent-1',role:'agent',email:'agent@example.test',network_entity_id:'entity-1'};
const distributor={id:'distributor-1',role:'distributor',email:'distributor@example.test',network_entity_id:'entity-2'};
const order={id:'WC-42',number:'42',status:'completed',customer:'Centro',customerEmail:'center@example.test',agentProfileId:'old-profile',assignmentEntityId:'old-entity',assignmentConflict:true,items:[{productId:4640,quantity:2,name:'ODR1'},{productId:4640,quantity:1,name:'ODR1'},{productId:99,quantity:8,name:'Altro'}]};
const args={admin:true,orderId:'WC-42',ownerId:owner.id,orders:[order],owners:[owner,distributor],mappings:[{product_id:4640,course_id:'course'}],courses:[{id:'course',title:'Corsi',active:true,material_ids:['video']}],existing:[]};
const result=prepareAlignment(args);
assert.equal(result.owner.id,owner.id);
assert.equal(result.order.assignmentMode,'manual');
assert.equal(result.order.assignmentEntityId,'entity-1');
assert.equal(result.order.assignmentConflict,false);
assert.equal(result.plan.result[0].quantity,3);
assert.deepEqual(result.plan.result[0].materialIds,['video']);
assert.equal(result.plan.result[0].recipient.recipient_email,'center@example.test');
assert.equal(order.assignmentEntityId,'old-entity');
assert.equal(prepareAlignment({...args,ownerId:distributor.id}).plan.result[0].recipient,null);
const rejected=(patch,status)=>assert.throws(()=>prepareAlignment({...args,...patch}),e=>e instanceof AlignmentError&&e.status===status);
rejected({admin:false},403);
rejected({orderId:'invalid'},400);
rejected({orderId:'404'},404);
rejected({ownerId:'unknown'},400);
rejected({owners:[{...owner,network_entity_id:null}]},400);
rejected({owners:[owner,{...owner,id:'duplicate'}]},400);
rejected({owners:[{...owner,role:'center'}]},400);
rejected({mappings:[]},400);
rejected({courses:[{...args.courses[0],active:false}]},400);
for(const status of ['pending','on-hold','odr-partial','cancelled','failed','refunded'])rejected({orders:[{...order,status}]},409);
for(const claimed of [{assigned_at:'2026-10-24'},{activated_at:'2026-10-24'},{activated_by:'academy-user'}]){
 rejected({existing:[{id:'code-1',owner_id:distributor.id,...claimed}]},409);
 assert.equal(prepareAlignment({...args,existing:[{id:'code-1',owner_id:owner.id,...claimed}]}).owner.id,owner.id);
}
assert.equal(prepareAlignment({...args,existing:[{id:'unassigned',owner_id:distributor.id}]}).owner.id,owner.id);
console.log('Manual voucher alignment: admin scope, fresh order eligibility, unique approved owner, preserved claimed vouchers, package quantities and course scope OK');
