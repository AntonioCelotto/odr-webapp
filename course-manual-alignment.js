const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function openManualAlignment({order,vouchers,owners,statusLabel,onSubmit,orders=[]}){
 document.querySelector('[data-manual-alignment-dialog]')?.remove();
 const dialog=document.createElement('dialog'),returnFocus=document.activeElement;
 dialog.className='course-alignment-dialog';dialog.dataset.manualAlignmentDialog='';
 dialog.setAttribute('aria-labelledby','course-alignment-title');
 const choices=owners.filter(o=>o.network_entity_id&&owners.filter(x=>x.network_entity_id===o.network_entity_id).length===1);
 const existing=vouchers.filter(v=>v.source_order===order.id);
 const current=existing.length&&existing.every(v=>v.owner_id===existing[0].owner_id)?existing[0].owner_id:choices.find(o=>o.network_entity_id===order.assignmentEntityId)?.id||'';
 const eligible=['processing','completed'].includes(order.status);
 const quantity=(order.courseItems||[]).reduce((sum,item)=>sum+Math.max(0,Math.floor(Number(item.quantity)||0)),0);
 const status=v=>!v.active?'Non attivo':v.activated_at?'Attivato':v.assigned_at?'Assegnato':'Da assegnare';
 const list=rows=>rows.length?`<ul class="course-voucher-codes">${rows.map(v=>`<li><code>${esc(v.code)}</code><span>${esc(status(v))}</span></li>`).join('')}</ul>`:'<p>Nessun voucher ancora generato.</p>';
 dialog.innerHTML=`<div class="course-alignment-heading"><h2 id="course-alignment-title">Allinea manualmente</h2><button type="button" class="secondary-action" data-close>Chiudi</button></div>
 ${orders.length?`<label class="course-alignment-picker">Ordine da allineare<select data-pick-order>${orders.map(o=>`<option value="${esc(o.id)}" ${o.id===order.id?'selected':''}>${esc(o.number||o.id)} · ${esc(o.customerCompany||o.customer)}</option>`).join('')}</select></label>`:''}
 <p><strong>Ordine ${esc(order.number||order.id)}</strong><br>${esc(order.customerCompany||order.customer)}<br>${esc(order.customerEmail||'')}</p>
 <p>Stato: <strong>${esc(statusLabel(order.status))}</strong> · Pacchetti acquistati: <strong>${quantity}</strong></p>
 <h3>Voucher dell’ordine</h3><div data-existing-vouchers>${list(existing)}</div>
 <form class="course-form"><label>Agente o distributore<select name="ownerId" required><option value="">Seleziona il referente</option>${choices.map(o=>`<option value="${esc(o.id)}" ${o.id===current?'selected':''}>${esc(o.full_name)} · ${o.role==='agent'?'Agente':'Distributore'}</option>`).join('')}</select></label>
 <p>L’associazione sarà salvata anche nell’ordine. Verranno creati soltanto i codici mancanti; i voucher già assegnati o attivati manterranno il loro referente.</p>
 ${!eligible?'<p class="auth-message">Prima conferma l’ordine: l’allineamento è disponibile solo per gli stati In lavorazione e Completato.</p>':''}
 <p class="auth-message" role="status" data-alignment-message></p>
 <button class="primary-action" ${!eligible||!choices.length?'disabled':''}>Conferma allineamento</button></form>`;
 let submitting=false;
 const picker=dialog.querySelector('[data-pick-order]');if(picker)picker.onchange=()=>{const selected=orders.find(o=>o.id===picker.value);if(selected)openManualAlignment({order:selected,orders,vouchers,owners,statusLabel,onSubmit});};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
 dialog.addEventListener('close',()=>{dialog.remove();if(returnFocus?.isConnected)returnFocus.focus();},{once:true});
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(submitting||!eligible)return;
  const ownerId=dialog.querySelector('[name=ownerId]').value;
  const owner=choices.find(o=>o.id===ownerId);if(!owner)return;
  const message=dialog.querySelector('[data-alignment-message]');
  if(existing.some(v=>(v.assigned_at||v.activated_at)&&v.owner_id!==ownerId)){message.textContent='Un voucher è già assegnato o attivato con un altro referente. Seleziona il referente attuale.';return;}
  submitting=true;dialog.querySelectorAll('button,select').forEach(el=>el.disabled=true);message.textContent='Allineamento in corso…';
  try{
   const result=await onSubmit({orderId:order.id,ownerId});
   const rows=result.vouchers.filter(v=>v.source_order===order.id);
   dialog.querySelector('[data-existing-vouchers]').innerHTML=list(rows);
   message.textContent=`Allineamento completato: ${result.alignment?.created||0} nuovi voucher, ${rows.length} totali per questo ordine.${result.warning?' '+result.warning:''}`;
  }catch(error){message.textContent=error.message;}
  finally{submitting=false;dialog.querySelectorAll('button,select').forEach(el=>el.disabled=false);}
 };
 document.body.append(dialog);dialog.showModal();
}
