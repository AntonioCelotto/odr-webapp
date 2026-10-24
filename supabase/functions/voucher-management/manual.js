import {plans} from './model.js';

export class AlignmentError extends Error {
 constructor(message,status=409){super(message);this.status=status;}
}

// Re-read orders and approved owners on the server. No quantities, course IDs,
// customer details or voucher codes supplied by the client are accepted.
export function prepareAlignment({admin,orderId,ownerId,orders,owners,mappings,courses,existing}){
 if(!admin)throw new AlignmentError('Allineamento riservato agli amministratori',403);
 const id=String(orderId||'').replace(/^WC-/,'');
 if(!/^[1-9]\d*$/.test(id))throw new AlignmentError('Ordine non valido',400);
 const order=orders.find(o=>o.id==='WC-'+id);
 if(!order)throw new AlignmentError('Ordine non disponibile',404);
 if(!['processing','completed'].includes(order.status))throw new AlignmentError('Prima conferma l’ordine: sono ammessi solo In lavorazione e Completato.');
 const owner=owners.find(o=>o.id===ownerId&&['agent','distributor'].includes(o.role)&&o.network_entity_id);
 if(!owner||owners.filter(o=>o.network_entity_id===owner.network_entity_id).length!==1)throw new AlignmentError('Seleziona un referente approvato con un collegamento univoco alla rete.',400);
 if(existing.some(v=>(v.assigned_at||v.activated_by||v.activated_at)&&v.owner_id!==owner.id))throw new AlignmentError('Un voucher è già assegnato o attivato con un altro referente. Il referente non può essere cambiato.');
 const corrected={...order,assignmentMode:'manual',assignmentEntityId:owner.network_entity_id,assignmentConflict:false};
 const plan=plans([corrected],mappings,courses,owners,owner.id,true);
 if(!plan.result.length||plan.result.some(x=>x.owner.id!==owner.id))throw new AlignmentError('Nessun corso attivo collegato ai prodotti dell’ordine.',400);
 return {order:corrected,owner,plan};
}
