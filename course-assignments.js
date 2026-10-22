import { trainingOrderItems, orderClient } from './course-orders.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0;
export async function mountCourseAssignments(root,supabase,user){
 const run=++generation;let data=null,customers=[],products=[],materials=[],orders=[],ordersLoading=true,ordersError='',busy=false,vdata={vouchers:[],owners:[],history:[]};
 const api=async(action)=>{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');
  const r=await fetch(`${supabase.supabaseUrl}/functions/v1/course-management`,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,apikey:supabase.supabaseKey,'Content-Type':'application/json'},...(action?{body:JSON.stringify(action)}:{})});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Operazione non riuscita');return d;
 };
 const vapi=async(action)=>{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');
  const r=await fetch(`${supabase.supabaseUrl}/functions/v1/voucher-management`,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${session.access_token}`,apikey:supabase.supabaseKey,'Content-Type':'application/json'},...(action?{body:JSON.stringify(action)}:{})});
  const d=await r.json();if(!r.ok)throw Error(d.error||'Operazione non riuscita');return d;
 };
 const voucherText=v=>`Gentile ${v.recipient_name||'Centro'}, a seguito dell’acquisto del pacchetto ${v.package_name}, ti è stato assegnato il voucher ${v.code}, valido per i videocorsi: ${v.course_titles.join(', ')}. Registrati o accedi su https://www.ita318academy.it/materiale?paid=1, entra in Corsi a pagamento e inserisci il codice voucher. Il codice è utilizzabile una sola volta su un solo account.`;
 const date=v=>v?new Date(v).toLocaleString('it-IT'):'—';
 const voucherStatus=v=>!v.active?'Non attivo':v.activated_at?'Attivato':v.assigned_at?'Assegnato':'Da assegnare';
 const msg=text=>{const e=root.querySelector('[data-course-message]');if(e)e.textContent=text;};
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
  const options=data.courses.filter(c=>c.active).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
  const trainingOrders=orders.map(o=>({...o,courseItems:trainingOrderItems(o,products,data.mappings)})).filter(o=>o.courseItems.length);
  const vouchers=vdata.vouchers,freeVouchers=vouchers.filter(v=>v.active&&!v.assigned_at);
  root.innerHTML=`<div class="course-kpis"><div class="panel"><strong>${freeVouchers.length}</strong><span>Voucher da assegnare</span></div><div class="panel"><strong>${vouchers.filter(v=>v.active&&v.assigned_at&&!v.activated_at).length}</strong><span>Voucher assegnati</span></div><div class="panel"><strong>${vouchers.filter(v=>v.activated_at).length}</strong><span>Voucher attivati</span></div></div>
  <div class="section-actions"><button type="button" class="primary-action" data-sync>Aggiorna voucher dagli ordini</button><button type="button" class="secondary-action" data-refresh-orders>Ricarica ordini e clienti</button><a class="secondary-action" href="https://www.ita318academy.it/materiale?paid=1" target="_blank" rel="noopener">Apri Academy</a></div>
  <p class="auth-message" role="status" data-course-message></p>
  <div class="panel"><h3>Assegna un voucher al centro</h3><p>Ogni voucher corrisponde a un pacchetto acquistato. È obbligatorio almeno un recapito: email oppure cellulare. WhatsApp si apre con il testo pronto; premi tu Invia.</p>
  ${freeVouchers.length?`<form data-voucher-assign class="course-form"><label>Voucher e pacchetto<select name="voucherId" required>${freeVouchers.map(v=>`<option value="${esc(v.id)}">${esc(v.package_name)} · Ordine ${esc(v.order_number)} · ${esc(v.customer_name)} · ${esc(v.code)}</option>`).join('')}</select></label><label>Cliente (facoltativo)<select name="customer"><option value="">Inserisci i dati del centro</option>${customers.map((c,i)=>`<option value="${i}">${esc(c.company||c.name)} · ${esc(c.email)}</option>`).join('')}</select></label><label>Nome centro<input name="name" required maxlength="200"></label><label>Email<input type="email" name="email" maxlength="200"></label><label>Cellulare<input type="tel" name="phone" placeholder="+39…" maxlength="30"></label><button class="primary-action">Assegna voucher</button></form>`:'<p>Nessun voucher da assegnare. Collega le promo ai corsi e aggiorna i voucher dagli ordini confermati.</p>'}</div>
  <div class="panel"><h3>Voucher corsi di formazione</h3><div class="course-table-scroll"><table><thead><tr><th>Codice e stato</th><th>Pacchetto e videocorsi</th><th>Ordine e cliente</th><th>Agente / distributore</th><th>Centro assegnatario</th><th>Date</th><th>Comunicazioni</th></tr></thead><tbody>${vouchers.map(v=>`<tr><td><strong>${esc(v.code)}</strong><br>${esc(voucherStatus(v))}</td><td>${esc(v.package_name)}<br>${v.course_titles.map(esc).join('<br>')}</td><td>${esc(v.order_number)}<br>${esc(v.customer_name)}<br>${esc(v.customer_email)}</td><td>${esc(vdata.owners.find(o=>o.id===v.owner_id)?.full_name||vdata.owners.find(o=>o.id===v.owner_id)?.email||'')}</td><td>${esc(v.recipient_name||'Da assegnare')}<br>${esc(v.recipient_email||'')}<br>${esc(v.recipient_phone||'')}${v.activated_email?'<br>Account Academy: '+esc(v.activated_email):''}</td><td>Assegnazione: ${esc(date(v.assigned_at))}<br>Attivazione: ${esc(date(v.activated_at))}</td><td>${v.assigned_at&&v.active?`<button type="button" class="secondary-action" data-copy-voucher="${v.id}">Copia messaggio</button>${v.recipient_phone?`<a class="secondary-action" href="https://wa.me/${esc(v.recipient_phone.replace(/\D/g,''))}?text=${encodeURIComponent(voucherText(v))}" target="_blank" rel="noopener noreferrer">Invia su WhatsApp</a>`:''}${v.recipient_email&&v.email_status!=='sent'?`<button type="button" class="secondary-action" data-email-voucher="${v.id}">Riprova email</button>`:''}`:''}<br>${esc({sent:'Email inviata',pending:'Email in attesa',failed:'Email non inviata',not_configured:'Email: mittente da configurare',not_required:'Nessuna email richiesta'}[v.email_status]||'')}</td></tr>`).join('')||'<tr><td colspan="7">Nessun voucher generato. Configura le promo e i videocorsi inclusi qui sotto.</td></tr>'}</tbody></table></div></div>
  <div class="panel"><h3>Ordini con corsi di formazione</h3><p>ODR1 – VIDEO CORSO DI FORMAZIONE e prodotti collegati ai corsi. Un voucher per ogni pacchetto, anche quando comprende più videocorsi.</p>${ordersLoading?'<p>Ricerca ordini in corso…</p>':ordersError?`<p role="alert">${esc(ordersError)}</p>`:`<div class="course-table-scroll"><table><thead><tr><th>Ordine</th><th>Cliente</th><th>Prodotto</th><th>Quantità</th><th>Stato</th><th>Video collegati</th></tr></thead><tbody>${trainingOrders.map(o=>`<tr><td>${esc(o.number||o.id)}<br>${esc(o.date)}</td><td>${clientHtml(o)}</td><td>${o.courseItems.map(i=>esc(i.sku||'')+' '+esc(i.name)).join('<br>')}</td><td>${o.courseItems.map(i=>esc(i.quantity)).join('<br>')}</td><td>${esc(statusLabel(o.status))}</td><td>${o.courseItems.map(i=>{const maps=data.mappings.filter(m=>Number(m.product_id)===Number(i.productId));return maps.length?maps.map(m=>esc(data.courses.find(c=>c.id===m.course_id)?.title||'')).join('<br>'):'Video da collegare';}).join('<br>')}</td></tr>`).join('')||'<tr><td colspan="6">Nessun ordine con corsi.</td></tr>'}</tbody></table></div>`}</div>
  ${admin?`<details class="panel"><summary>Storico voucher</summary><div class="course-table-scroll"><table><thead><tr><th>Data</th><th>Operazione</th><th>Riferimento</th></tr></thead><tbody>${vdata.history.map(h=>`<tr><td>${esc(date(h.created_at))}</td><td>${esc(h.action)}</td><td>${esc(h.details?.voucherId||'')}</td></tr>`).join('')||'<tr><td colspan="3">Nessuna operazione.</td></tr>'}</tbody></table></div></details>`:''}
   ${admin?`<details class="panel course-settings"><summary>Configura corsi, promo e accessi</summary><div class="course-settings-grid">
   <form data-course class="course-form"><h3>Corso Academy</h3><label>Modifica un corso<select name="id"><option value="">Nuovo corso</option>${data.courses.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label><label>Titolo del corso<input name="title" required maxlength="180"></label><fieldset><legend>Video inclusi</legend>${materials.map(m=>`<label class="course-checkbox"><input type="checkbox" name="materials" value="${m.id}">${esc(m.title)} · ${m.access_type==='paid'?'a pagamento':'gratuito'}</label>`).join('')}</fieldset><label class="course-checkbox"><input type="checkbox" name="active" checked>Corso attivo</label><button class="primary-action">Salva corso</button><p>Su Academy imposta “A pagamento” per i video che devono essere visibili solo dopo l’assegnazione.</p></form>
   <div><form data-mapping class="course-form"><h3>Collega una promo al corso</h3><label>Prodotto o promo<select name="productId" required><option value="">Seleziona nello shop</option>${products.map(p=>`<option value="${p.id}">${esc(p.sku?p.sku+' · ':'')}${esc(p.name)}</option>`).join('')}</select></label><label>Corso<select name="courseId" required>${options}</select></label><input type="hidden" name="accessesPerUnit" value="1"><p>Un voucher per ogni pacchetto acquistato. Collega più corsi alla stessa promo per includerli nello stesso voucher.</p><button class="primary-action">Salva collegamento</button></form><h4>Collegamenti attivi</h4><ul>${data.mappings.map(m=>`<li>${esc(products.find(p=>p.id===m.product_id)?.name||'Prodotto #'+m.product_id)} → ${esc(data.courses.find(c=>c.id===m.course_id)?.title)} · incluso nel voucher</li>`).join('')||'<li>Nessun collegamento.</li>'}</ul></div>
   </div></details>`:''}`;
 }
 async function act(body,success){if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);msg('Operazione in corso…');try{data=await api(body);vdata=await vapi();render();msg(success);}catch(e){msg(e.message);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function vact(body,success){if(busy)return;busy=true;msg('Operazione in corso…');root.querySelectorAll('button').forEach(b=>b.disabled=true);try{vdata=await vapi(body);render();msg(vdata.warning||success);}catch(e){msg(e.message);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 root.onclick=async e=>{
  if(e.target.closest('[data-refresh-orders]')){if(!busy&&!ordersLoading){vdata=await vapi();await loadOrders();}return;}
  if(e.target.closest('[data-sync]'))return vact({action:'sync'},'Voucher aggiornati dagli ordini confermati.');
  const copy=e.target.closest('[data-copy-voucher]');if(copy){const v=vdata.vouchers.find(v=>v.id===copy.dataset.copyVoucher);try{await navigator.clipboard.writeText(voucherText(v));msg('Messaggio copiato.');}catch{msg(voucherText(v));}}
  const email=e.target.closest('[data-email-voucher]');if(email)return vact({action:'send-email',voucherId:email.dataset.emailVoucher},'Email inviata.');
 };
 root.onchange=e=>{
  if(e.target.name==='customer'&&e.target.value!==''){const c=customers[Number(e.target.value)],f=e.target.form;f.elements.name.value=c.company||c.name;f.elements.email.value=c.email||'';if(f.elements.phone)f.elements.phone.value=c.phone||'';}
  if(e.target.name==='id'){const c=data.courses.find(c=>c.id===e.target.value),f=e.target.form;f.elements.title.value=c?.title||'';f.elements.active.checked=c?.active!==false;f.querySelectorAll('[name=materials]').forEach(i=>i.checked=c?.material_ids.includes(i.value)||false);}
 };
 root.onsubmit=e=>{
  e.preventDefault();const f=e.target,v=Object.fromEntries(new FormData(f));
  if(f.matches('[data-voucher-assign]')){if(!v.email&&!v.phone){msg('Inserisci almeno email o cellulare.');return;}if(confirm(`Assegnare il voucher a ${v.name}?`))vact({action:'assign',...v},'Voucher assegnato.');}
  if(f.matches('[data-course]'))act({action:'save-course',...v,materialIds:new FormData(f).getAll('materials'),active:f.elements.active.checked},'Corso salvato.');
  if(f.matches('[data-mapping]'))act({action:'map-product',...v},'Collegamento salvato. Aggiorna gli accessi dagli ordini.');
 };
 root.textContent='Caricamento corsi…';
 try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Accedi nuovamente');const headers={Authorization:`Bearer ${session.access_token}`};
  data=await api();vdata=await vapi();
  const requests=[fetch('/api/agent-customers',{headers}).then(async r=>r.ok?(await r.json()).customers||[]:[])];
  requests.push(fetch('/api/catalog',{headers}).then(async r=>r.ok?(await r.json()).products||[]:[]));
  if(data.canManage)requests.push(fetch('https://hmezncgfhjyqifvyhect.supabase.co/functions/v1/academy-course-catalog').then(async r=>r.ok?(await r.json()).materials||[]:[]));
  const results=await Promise.all(requests);customers=results[0];products=results[1]||[];materials=results[2]||[];render();await loadOrders();if(!vdata.vouchers.length&&data.mappings.length)await vact({action:'sync'},'Voucher aggiornati.');
 }catch(e){if(run===generation)root.textContent=e.message;}
}
