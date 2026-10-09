import { trainingOrderItems, orderClient, availableBatches } from './course-orders.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0;
export async function mountCourseAssignments(root,supabase,user){
 const run=++generation;let data=null,customers=[],products=[],materials=[],orders=[],ordersLoading=true,ordersError='',busy=false;
 const api=async(action)=>{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');
  const r=await fetch(`${supabase.supabaseUrl}/functions/v1/course-management`,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,apikey:supabase.supabaseKey,'Content-Type':'application/json'},...(action?{body:JSON.stringify(action)}:{})});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Operazione non riuscita');return d;
 };
 const msg=text=>{const e=root.querySelector('[data-course-message]');if(e)e.textContent=text;};
 const invite=a=>`Il corso ${data.courses.find(c=>c.id===a.course_id)?.title||''} è stato assegnato a ${a.recipient_email}. Accedi o registrati su https://www.ita318academy.it/materiale con questa email. Per attivare i corsi conferma la mail tramite il link ricevuto.`;
 const sourceOrder=a=>orders.find(o=>o.id===a.source_order);
 const originLabel=a=>a.source_order.startsWith('manual:')?'Accesso amministrativo':`Ordine ${sourceOrder(a)?.number||a.source_order}`;
 const clientHtml=o=>{const c=orderClient(o);return c?`<strong>${esc(c.name)}</strong>${c.contact&&c.contact!==c.name?'<br>'+esc(c.contact):''}<br>${esc(c.email)}${c.phone?'<br>'+esc(c.phone):''}${c.address?'<br>'+esc(c.address):''}`:'Dati cliente non disponibili';};
 const statusLabel=s=>({processing:'In lavorazione',completed:'Completato',pending:'In attesa di pagamento','on-hold':'In attesa',cancelled:'Annullato',refunded:'Rimborsato',failed:'Fallito'}[s]||s);
 async function loadOrders(){
  ordersLoading=true;ordersError='';if(data)render();
  try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');
   const r=await fetch('/api/orders',{headers:{Authorization:`Bearer ${session.access_token}`}}),d=await r.json();
   if(!r.ok)throw Error(d.error||'Ordini non disponibili');orders=d.orders||[];
  }catch(e){ordersError=e.message;}
  finally{ordersLoading=false;if(data)render();}
 }
 function render(){
  if(run!==generation)return;const admin=data.canManage;
  const available=data.accesses.filter(a=>a.active&&!a.recipient_email&&data.courses.some(c=>c.id===a.course_id&&c.active));
  const assigned=data.accesses.filter(a=>a.recipient_email);
  const options=data.courses.filter(c=>c.active).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
  const batches=availableBatches(data.accesses,data.courses);
  const trainingOrders=orders.map(o=>({...o,courseItems:trainingOrderItems(o,products,data.mappings)})).filter(o=>o.courseItems.length);
  const orderOptions=batches.map(rows=>{const a=rows[0],o=sourceOrder(a),owner=data.owners.find(x=>x.id===a.owner_id);return `<option value="${esc(a.id)}">${esc(data.courses.find(c=>c.id===a.course_id)?.title)} · ${rows.length} disponibili · ${esc(originLabel(a))}${o?' · '+esc(orderClient(o).name):''}${admin?' · '+esc(owner?.full_name||owner?.email||''):''}</option>`}).join('');
  root.innerHTML=`<div class="course-kpis"><div class="panel"><strong>${available.length}</strong><span>Accessi da assegnare</span></div><div class="panel"><strong>${assigned.filter(a=>a.active).length}</strong><span>Accessi assegnati</span></div></div>
   <div class="section-actions"><button type="button" class="primary-action" data-sync>Aggiorna accessi dagli ordini</button><button type="button" class="secondary-action" data-refresh-orders>Ricarica ordini e clienti</button><a class="secondary-action" href="https://www.ita318academy.it/materiale" target="_blank" rel="noopener">Apri Academy</a></div>
   <p class="auth-message" role="status" data-course-message></p>
   <div class="panel"><h3>Ordini con corsi di formazione</h3><p>ODR1 – VIDEO CORSO DI FORMAZIONE e prodotti collegati ai corsi. Il cliente indicato è quello dell’ordine; il centro destinatario viene scelto nell’assegnazione.</p>
   ${ordersLoading?'<p role="status">Ricerca degli ordini in corso…</p>':ordersError?`<p role="alert">${esc(ordersError)}. Premi “Ricarica ordini e clienti” per riprovare.</p>`:`<p>${trainingOrders.length} ordini trovati.</p><div class="course-table-scroll"><table><thead><tr><th>Codice ordine e data</th><th>Cliente</th><th>Codice e prodotto</th><th>Quantità</th><th>Stato ordine</th><th>Collegamento ai corsi</th></tr></thead><tbody>${trainingOrders.map(o=>`<tr><td><strong>${esc(o.number||o.id)}</strong><br>${esc(o.id)}<br>${esc(o.date)}</td><td>${clientHtml(o)}</td><td>${o.courseItems.map(i=>`${esc(i.sku||products.find(p=>Number(p.id)===Number(i.productId))?.sku||'ODR1')} · ${esc(i.name)}`).join('<br>')}</td><td>${o.courseItems.map(i=>esc(i.quantity)).join('<br>')}</td><td>${esc(statusLabel(o.status))}</td><td>${o.courseItems.map(i=>{const maps=data.mappings.filter(m=>Number(m.product_id)===Number(i.productId));return maps.length?maps.map(m=>esc(data.courses.find(c=>c.id===m.course_id)?.title||'Corso')+' · '+esc(m.accesses_per_unit)+' accessi per unità').join('<br>'):'Video da collegare';}).join('<br>')}</td></tr>`).join('')||'<tr><td colspan="6">Nessun ordine con ODR1 o prodotti collegati ai corsi.</td></tr>'}</tbody></table></div>`}</div>
   <div class="panel"><h3>Accessi disponibili per ordine e cliente</h3><div class="course-table-scroll"><table><thead><tr><th>Corso</th><th>Codice ordine</th><th>Cliente dell’ordine</th><th>Disponibili</th>${admin?'<th>Assegnatario commerciale</th>':''}</tr></thead><tbody>${batches.map(rows=>{const a=rows[0];return `<tr><td>${esc(data.courses.find(c=>c.id===a.course_id)?.title)}</td><td>${esc(originLabel(a))}</td><td>${a.source_order.startsWith('manual:')?'Accesso aggiunto dall’amministratore':ordersLoading?'Caricamento cliente…':clientHtml(sourceOrder(a))}</td><td>${rows.length}</td>${admin?'<td>'+esc(data.owners.find(o=>o.id===a.owner_id)?.full_name||data.owners.find(o=>o.id===a.owner_id)?.email||'')+'</td>':''}</tr>`;}).join('')||`<tr><td colspan="${admin?5:4}">Nessun accesso disponibile. Gli ordini già trovati sono elencati sopra; scegli prima i video da collegare al prodotto.</td></tr>`}</tbody></table></div></div>
   <div class="panel"><h3>Assegna un corso a un centro benessere</h3><p>Seleziona un accesso disponibile e la mail che il centro userà su Academy. Ogni assegnazione utilizza un accesso.</p>
   ${available.length?`<form data-assign class="course-form"><label>Corso e accessi disponibili<select name="accessId" required>${orderOptions}</select></label>
   <label>Seleziona un cliente (facoltativo)<select name="customer"><option value="">Inserisci nome ed email</option>${customers.map((c,i)=>`<option value="${i}">${esc(c.company||c.name)} · ${esc(c.email)}</option>`).join('')}</select></label>
   <label>Nome del centro<input name="name" required maxlength="200"></label><label>Email per Academy<input type="email" name="email" required maxlength="200" autocomplete="email"></label><button class="primary-action">Assegna corso</button></form>`:'<p>Nessun accesso disponibile. Premi “Aggiorna accessi dagli ordini” dopo un acquisto. Le promo devono essere collegate ai corsi dall’amministratore.</p>'}</div>
   <div class="panel"><h3>Assegnazioni ai centri</h3><div class="course-table-scroll"><table><thead><tr><th>Corso</th><th>Centro e email</th><th>Codice ordine</th><th>Cliente dell’ordine</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>${assigned.map(a=>`<tr><td>${esc(data.courses.find(c=>c.id===a.course_id)?.title)}</td><td>${esc(a.recipient_name)}<br>${esc(a.recipient_email)}</td><td>${esc(originLabel(a))}${admin?'<br>'+esc(data.owners.find(o=>o.id===a.owner_id)?.full_name||''):''}</td><td>${a.source_order.startsWith('manual:')?'Accesso aggiunto dall’amministratore':ordersLoading?'Caricamento cliente…':clientHtml(sourceOrder(a))}</td><td>${a.active?'Assegnato':'Non attivo'}</td><td>${a.active?`<button type="button" class="secondary-action" data-invite="${a.id}">Copia invito</button>`:''}${admin?`<button type="button" class="danger-action" data-revoke="${a.id}">Annulla assegnazione</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6">Nessuna assegnazione.</td></tr>'}</tbody></table></div></div>
   ${admin?`<details class="panel course-settings"><summary>Configura corsi, promo e accessi</summary><div class="course-settings-grid">
   <form data-course class="course-form"><h3>Corso Academy</h3><label>Modifica un corso<select name="id"><option value="">Nuovo corso</option>${data.courses.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Titolo del corso<input name="title" required maxlength="180"></label><fieldset><legend>Video inclusi</legend>${materials.map(m=>`<label class="course-checkbox"><input type="checkbox" name="materials" value="${m.id}">${esc(m.title)} · ${m.access_type==='paid'?'a pagamento':'gratuito'}</label>`).join('')}</fieldset><label class="course-checkbox"><input type="checkbox" name="active" checked>Corso attivo</label><button class="primary-action">Salva corso</button><p>Su Academy imposta “A pagamento” per i video che devono essere visibili solo dopo l’assegnazione.</p></form>
   <div><form data-mapping class="course-form"><h3>Collega una promo al corso</h3><label>Prodotto o promo<select name="productId" required><option value="">Seleziona nello shop</option>${products.map(p=>`<option value="${p.id}">${esc(p.sku?p.sku+' · ':'')}${esc(p.name)}</option>`).join('')}</select></label><label>Corso<select name="courseId" required>${options}</select></label><label>Accessi per ogni unità acquistata<input name="accessesPerUnit" type="number" min="1" max="100" value="1" required></label><button class="primary-action">Salva collegamento</button></form><h4>Collegamenti attivi</h4><ul>${data.mappings.map(m=>`<li>${esc(products.find(p=>p.id===m.product_id)?.name||'Prodotto #'+m.product_id)} → ${esc(data.courses.find(c=>c.id===m.course_id)?.title)} · ${m.accesses_per_unit} accessi</li>`).join('')||'<li>Nessun collegamento.</li>'}</ul></div>
   <form data-grant class="course-form"><h3>Aggiungi accessi manualmente</h3><label>Agente, distributore o amministratore<select name="ownerId" required>${data.owners.map(o=>`<option value="${o.id}">${esc(o.full_name||o.email)} · ${esc(o.role)}</option>`).join('')}</select></label><label>Corso<select name="courseId" required>${options}</select></label><label>Numero di accessi<input type="number" name="quantity" value="1" min="1" max="100" required></label><label>Motivo<input name="note" required maxlength="300" placeholder="Ordine precedente, omaggio…"></label><button class="primary-action">Aggiungi accessi</button></form>
   </div></details>`:''}`;
 }
 async function act(body,success){if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);msg('Operazione in corso…');try{data=await api(body);render();msg(success);}catch(e){msg(e.message);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 root.onclick=async e=>{
  if(e.target.closest('[data-refresh-orders]')){if(!busy&&!ordersLoading)await loadOrders();return;}
  if(e.target.closest('[data-sync]')){await act({action:'sync'},'Accessi aggiornati dagli ordini confermati.');if(!ordersLoading)await loadOrders();return;}
  const copy=e.target.closest('[data-invite]');if(copy){try{await navigator.clipboard.writeText(invite(data.accesses.find(a=>a.id===copy.dataset.invite)));msg('Invito copiato. Puoi inviarlo al centro via email o WhatsApp.');}catch{msg(invite(data.accesses.find(a=>a.id===copy.dataset.invite)));}}
  const revoke=e.target.closest('[data-revoke]');if(revoke&&confirm('Annullare l’assegnazione? Il centro perderà l’accesso al prossimo controllo, entro 15 minuti.'))return act({action:'revoke',accessId:revoke.dataset.revoke},'Assegnazione annullata, accesso nuovamente disponibile.');
 };
 root.onchange=e=>{
  if(e.target.name==='customer'&&e.target.value!==''){const c=customers[Number(e.target.value)],f=e.target.form;f.elements.name.value=c.company||c.name;f.elements.email.value=c.email;}
  if(e.target.name==='id'){const c=data.courses.find(c=>c.id===e.target.value),f=e.target.form;f.elements.title.value=c?.title||'';f.elements.active.checked=c?.active!==false;f.querySelectorAll('[name=materials]').forEach(i=>i.checked=c?.material_ids.includes(i.value)||false);}
 };
 root.onsubmit=e=>{
  e.preventDefault();const f=e.target,v=Object.fromEntries(new FormData(f));
  if(f.matches('[data-assign]')){if(confirm(`Assegnare il corso a ${v.email}? Verrà utilizzato un accesso.`))act({action:'assign',...v},'Corso assegnato. Copia l’invito qui sotto e invialo al centro.');}
  if(f.matches('[data-course]'))act({action:'save-course',...v,materialIds:new FormData(f).getAll('materials'),active:f.elements.active.checked},'Corso salvato.');
  if(f.matches('[data-mapping]'))act({action:'map-product',...v},'Collegamento salvato. Aggiorna gli accessi dagli ordini.');
  if(f.matches('[data-grant]'))act({action:'manual-grant',...v},'Accessi aggiunti.');
 };
 root.textContent='Caricamento corsi…';
 try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');const headers={Authorization:`Bearer ${session.access_token}`};
  data=await api();
  const requests=[fetch('/api/agent-customers',{headers}).then(async r=>r.ok?(await r.json()).customers||[]:[])];
  requests.push(fetch('/api/catalog',{headers}).then(async r=>r.ok?(await r.json()).products||[]:[]));
  if(data.canManage)requests.push(fetch('https://hmezncgfhjyqifvyhect.supabase.co/functions/v1/academy-course-catalog').then(async r=>r.ok?(await r.json()).materials||[]:[]));
  const results=await Promise.all(requests);customers=results[0];products=results[1]||[];materials=results[2]||[];render();await loadOrders();
 }catch(e){if(run===generation)root.textContent=e.message;}
}
