export function contact(email,phone){
 const e=String(email||'').trim().toLowerCase(),raw=String(phone||'').trim();
 if(e&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw Error('Email non valida');
 let p=raw.replace(/[\s().-]/g,'').replace(/^00/,'+');
 if(p&&!p.startsWith('+'))p='+39'+p;
 if(p&&!/^\+[1-9]\d{6,14}$/.test(p))throw Error('Numero di cellulare non valido');
 if(!e&&!p)throw Error('Inserisci almeno email o cellulare');
 return {recipient_email:e||null,recipient_phone:p||null};
}
export function plans(orders,mappings,courses,owners,actor,admin){
 const result=[],unmatched=[];
 for(const order of orders){
  const relevant=(order.items||[]).filter(l=>mappings.some(m=>Number(m.product_id)===Number(l.productId)));
  if(!relevant.length)continue;
  const explicit=owners.find(o=>o.id===order.agentProfileId);
  const buyers=owners.filter(o=>o.email&&o.email.toLowerCase()===String(order.customerEmail||'').toLowerCase());
  // Use the same resolved commercial association displayed in Orders, including
  // corrections saved by administrators; never guess from names or parent networks.
  const entityId=order.assignmentEntityId||order.agentEntityId||order.distributorEntityId;
  const associated=entityId?owners.filter(o=>o.network_entity_id===entityId):[];
  const linked=associated.length===1?associated[0]:null;
  const buyer=buyers.length===1?buyers[0]:null;
  const owner=order.assignmentConflict?null:order.assignmentMode==='manual'?linked:explicit||buyer||linked;
  if(!owner||(!admin&&owner.id!==actor)){unmatched.push(order.id);continue;}
  const direct=(owner===explicit||owner.role==='agent') && String(owner.email||'').toLowerCase()!==String(order.customerEmail||'').toLowerCase();
  for(const productId of new Set(relevant.map(l=>Number(l.productId)))){
   const lines=relevant.filter(l=>Number(l.productId)===productId),quantity=lines.reduce((s,l)=>s+Math.max(0,Math.floor(Number(l.quantity)||0)),0);
   if(quantity>1000)throw Error('Quantità voucher troppo elevata');
   const included=mappings.filter(m=>Number(m.product_id)===productId).map(m=>courses.find(c=>c.id===m.course_id&&c.active)).filter(Boolean);
   if(!included.length)continue;
   let recipient=null;
   if(direct){try{recipient={recipient_name:order.customerCompany||order.center||order.customer,...contact(order.customerEmail,order.customerPhone)};}catch{unmatched.push(order.id);}}
   result.push({order,owner,productId,quantity,eligible:['processing','completed'].includes(order.status),direct,recipient,materialIds:[...new Set(included.flatMap(c=>c.material_ids))],titles:included.map(c=>c.title),packageName:lines[0].name});
  }
 }
 return {result,unmatched:[...new Set(unmatched)]};
}
