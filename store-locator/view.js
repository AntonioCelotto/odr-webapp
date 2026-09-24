import L from 'leaflet';
import {mountPosition} from './position.js';
import 'leaflet.markercluster';
import readXlsxFile from 'read-excel-file';
import {categories,validate,parseExcelRows,safeUrl,normalize} from './model.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function mountLocator(root,client,admin=false,network=[]) {
 let stores=[],internals=new Map(),preview=[],busy=false,map,markers,disposed=false;
 const q=s=>root.querySelector(s);
 root.innerHTML=`<div class="locator-heading"><div><small>ODR GLOBAL NETWORK</small><h2>${admin?'Gestione Store Locator':'Trova il tuo centro ODR'}</h2><p>Centri estetici, parrucchieri e distributori in Italia e nel mondo.</p></div>${admin?'<a href="/store-locator" target="_blank" rel="noopener">Apri mappa pubblica ↗</a>':''}</div>
 ${admin?'<div class="locator-actions"><button id="sl-new">Aggiungi struttura</button><label class="sl-upload">Importa Excel<input id="sl-file" type="file" accept=".xlsx"></label><button id="sl-refresh" class="secondary">Aggiorna</button><span>Excel .xlsx · massimo 500 strutture · 5 MB</span></div>':''}
 <p id="sl-message" role="status"></p><div class="locator-filters"><label>Cerca<input id="sl-search" type="search" placeholder="Nome, città o CAP"></label><label>Paese<select id="sl-country"><option value="">Tutti i Paesi</option></select></label><label>Tipologia<select id="sl-type"><option value="">Tutte le tipologie</option>${Object.entries(categories).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>${admin?'<label>Stato<select id="sl-state"><option value="">Tutte le schede</option><option value="public">Attive e approvate</option><option value="draft">Da approvare / inattive</option><option value="unplaced">Da posizionare</option></select></label>':''}</div>
 <p id="sl-count"></p><div class="locator-layout"><div id="sl-list" class="locator-list"></div><div id="sl-map" class="locator-map" aria-label="Mappa strutture ODR"></div></div>
 <dialog id="sl-dialog"><form id="sl-form"><div class="locator-heading"><h2>Scheda struttura</h2><button type="button" id="sl-close" aria-label="Chiudi">×</button></div><div id="sl-fields" class="locator-form"></div><p id="sl-form-message" role="alert"></p><button type="submit">Salva scheda</button></form></dialog>
 <dialog id="sl-import"><h2>Anteprima importazione</h2><p>Le nuove schede saranno salvate come inattive e da approvare. Le righe con errori e i doppioni saranno esclusi. Le schede esistenti non vengono sovrascritte.</p><div id="sl-preview"></div><div class="locator-actions"><button id="sl-confirm">Importa righe valide</button><button id="sl-cancel">Annulla</button></div><p id="sl-import-message" role="alert"></p></dialog>`;
 const message=(s)=>{q('#sl-message').textContent=s;};
 async function load() {
  message('Caricamento strutture…');
  try {
   let all=[];
   for(let from=0;;from+=1000){const {data,error}=await client.from('store_locations').select('*').order('name').order('id').range(from,from+999);if(error)throw error;all.push(...data);if(data.length<1000)break;}
   if(disposed)return;
   stores=all;
   if(admin){const allInternal=[];for(let from=0;;from+=1000){const {data,error}=await client.from('store_location_internal').select('*').order('store_id').range(from,from+999);if(error)throw error;allInternal.push(...data);if(data.length<1000)break;}internals=new Map(allInternal.map(r=>[r.store_id,r]));}
   if(disposed)return;
   const selected=q('#sl-country').value;
   q('#sl-country').innerHTML='<option value="">Tutti i Paesi</option>'+[...new Set(stores.map(r=>r.country))].sort().map(c=>`<option>${esc(c)}</option>`).join('');q('#sl-country').value=selected;
   message('');render();
  }catch{if(!disposed)message('Impossibile caricare le strutture. Riprova con Aggiorna o ricarica la pagina.');}
 }
 const positioned=r=>r.latitude!==null&&r.longitude!==null;
 function card(r) {
  const url=safeUrl(r.website);
  const directions='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent([r.address,r.postcode,r.city,r.country].filter(Boolean).join(', '));
  return `<article class="locator-card"><div class="locator-tags">${r.categories.map(c=>`<span>${esc(categories[c])}</span>`).join('')}</div><h3>${esc(r.name)}</h3><p>${esc([r.address,r.postcode,r.city,r.province,r.country].filter(Boolean).join(', '))}</p>${r.phone||r.mobile?`<p>${esc(r.phone||r.mobile)}</p>`:''}${r.email?`<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:''}<div class="locator-actions"><a href="${directions}" target="_blank" rel="noopener">Indicazioni stradali ↗</a>${url?`<a href="${esc(url)}" target="_blank" rel="noopener">Sito web ↗</a>`:''}${admin?`<button data-edit="${r.id}">Modifica</button>`:''}</div>${admin?`<small>${r.active&&r.approved?'Attiva e approvata':'Inattiva / da approvare'}${!positioned(r)?' · Da posizionare sulla mappa':''}</small>`:''}</article>`;
 }
 function render() {
  const search=normalize(q('#sl-search').value),country=q('#sl-country').value,type=q('#sl-type').value,state=q('#sl-state')?.value;
  const rows=stores.filter(r=>(!country||r.country===country)&&(!type||r.categories.includes(type))&&(!search||normalize([r.name,r.city,r.postcode,r.region].join(' ')).includes(search)))
   .filter(r=>!state||(state==='public'?r.active&&r.approved:state==='unplaced'?!positioned(r):!r.active||!r.approved));
  q('#sl-count').textContent=`${rows.length} strutture · ${rows.filter(positioned).length} sulla mappa`;
  q('#sl-list').innerHTML=rows.length?rows.map(card).join(''):'<div class="locator-empty">Nessuna struttura disponibile con questi filtri.</div>';
  if(!map){map=L.map(q('#sl-map')).setView([42.5,12.5],5);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(map);markers=L.markerClusterGroup();map.addLayer(markers);}
  markers.clearLayers();
  rows.filter(positioned).forEach(r=>{const marker=L.marker([r.latitude,r.longitude],{icon:L.divIcon({className:'locator-pin',html:'<span>ODR</span>',iconSize:[38,38]})});marker.bindPopup(card(r));markers.addLayer(marker);});
  map.invalidateSize();if(markers.getLayers().length)map.fitBounds(markers.getBounds(),{padding:[30,30],maxZoom:13});
 }
 ['#sl-search','#sl-country','#sl-type','#sl-state'].forEach(id=>q(id)?.addEventListener('input',render));
 const fields={name:'Nome struttura',address:'Indirizzo',postcode:'CAP',city:'Città',province:'Provincia',region:'Regione',country:'Paese',email:'Email pubblica',phone:'Telefono pubblico',mobile:'Cellulare pubblico',website:'Sito web',facebook:'Facebook',instagram:'Instagram',tiktok:'TikTok',youtube:'YouTube',whatsapp:'WhatsApp',latitude:'Latitudine',longitude:'Longitudine'};
 let editing=null, disposePosition=null;
 q('#sl-dialog').addEventListener('close',()=>{disposePosition?.();disposePosition=null;});
 function edit(id) {
  if(!admin)return;disposePosition?.();disposePosition=null;editing=stores.find(r=>r.id===id)||null;const r=editing||{country:'Italia',categories:['beauty']},inside=internals.get(id)||{};
  q('#sl-fields').innerHTML=Object.entries(fields).map(([key,label])=>`<label>${label}<input name="${key}" value="${esc(r[key]??'')}" ${['name','address','city','country'].includes(key)?'required':''} ${key==='email'?'type="email"':'type="text"'} maxlength="500"></label>`).join('')+`<fieldset><legend>Tipologie e specializzazioni</legend>${Object.entries(categories).map(([k,v])=>`<label class="sl-check"><input type="checkbox" name="category" value="${k}" ${r.categories.includes(k)?'checked':''}>${v}</label>`).join('')}</fieldset><fieldset><legend>Pubblicazione</legend><label class="sl-check"><input type="checkbox" name="active" ${r.active?'checked':''}>Struttura attiva</label><label class="sl-check"><input type="checkbox" name="approved" ${r.approved?'checked':''}>Approvata per la mappa pubblica</label><p>La scheda appare nell’elenco pubblico quando è attiva e approvata. Per il segnaposto servono entrambe le coordinate.</p></fieldset><fieldset><legend>Informazioni riservate</legend><label>Agente o distributore<select name="owner_entity_id"><option value="">Da assegnare</option>${network.filter(n=>(n.active||inside.owner_entity_id===n.id)&&['agent','distributor'].includes(n.type)).map(n=>`<option value="${n.id}" ${inside.owner_entity_id===n.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label><label>Riferimento originale<input name="reference" value="${esc(inside.reference)}"></label><label>Referente<input name="contact" value="${esc(inside.contact)}"></label><label>Note interne<textarea name="notes">${esc(inside.notes)}</textarea></label></fieldset>`;
  q('#sl-form-message').textContent='';q('#sl-dialog').showModal();disposePosition=mountPosition(q('#sl-form'),client);
 }
 root.addEventListener('click',e=>{const b=e.target.closest('[data-edit]');if(b)edit(b.dataset.edit);});
 q('#sl-new')?.addEventListener('click',()=>edit(''));
 ['#sl-dialog','#sl-import'].forEach(id=>q(id).addEventListener('cancel',e=>{if(busy)e.preventDefault();}));
 q('#sl-close').addEventListener('click',()=>{if(!busy)q('#sl-dialog').close();});
 q('#sl-refresh')?.addEventListener('click',load);
 q('#sl-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!admin||busy)return;
  const f=new FormData(e.target),row=Object.fromEntries(Object.keys(fields).map(k=>[k,String(f.get(k)||'').trim()]));
  for(const k of ['latitude','longitude'])row[k]=row[k]===''?null:Number(row[k].replace(',','.'));
  row.categories=f.getAll('category');row.active=f.has('active');row.approved=f.has('approved');if(editing)row.id=editing.id;
  const errors=validate(row);if(errors.length){q('#sl-form-message').textContent=errors.join(' · ');return;}
  busy=true;const button=e.target.querySelector('[type=submit]');button.disabled=true;
  try{const internal=Object.fromEntries(['reference','contact','notes','owner_entity_id'].map(k=>[k,String(f.get(k)||'')]));const {error}=await client.rpc('save_store_locations',{entries:[{row,internal}]});if(error)throw error;q('#sl-dialog').close();await load();message('Scheda salvata.');}catch(err){q('#sl-form-message').textContent=err.code==='23505'?'Esiste già una struttura con questo nome e indirizzo.':'Salvataggio non riuscito. Controlla i dati e riprova.';}finally{busy=false;button.disabled=false;}
 });
 q('#sl-file')?.addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>5*1024*1024)throw new Error('Il file supera 5 MB.');const rows=await readXlsxFile(file);if(rows.length>501)throw new Error('Massimo 500 strutture per file.');preview=parseExcelRows(rows,stores);q('#sl-preview').innerHTML=`<p>${preview.filter(r=>!r.duplicate&&!r.errors.length).length} righe importabili su ${preview.length}</p><div class="sl-preview-scroll"><table><thead><tr><th>Riga</th><th>Struttura</th><th>Esito</th></tr></thead><tbody>${preview.map(p=>`<tr><td>${p.line}</td><td>${esc(p.row.name)}</td><td>${esc(p.duplicate?'Doppione: escluso':p.errors.length?p.errors.join(', '):p.warnings.length?'Pronta · '+p.warnings.join(', '):'Pronta')}</td></tr>`).join('')}</tbody></table></div>`;q('#sl-import-message').textContent='';q('#sl-confirm').disabled=!preview.some(r=>!r.duplicate&&!r.errors.length);q('#sl-import').showModal();}catch(err){message(err.message||'File non leggibile. Usa Excel .xlsx.');}finally{e.target.value='';}
 });
 q('#sl-cancel').addEventListener('click',()=>{if(!busy)q('#sl-import').close();});
 q('#sl-confirm').addEventListener('click',async()=>{
  if(busy||!admin)return;busy=true;q('#sl-confirm').disabled=true;
  try{const entries=preview.filter(p=>!p.duplicate&&!p.errors.length).map(({row,internal})=>({row,internal}));const {error,data}=await client.rpc('save_store_locations',{entries});if(error)throw error;q('#sl-import').close();await load();message(`${data} strutture importate, da completare e approvare.`);}catch{q('#sl-import-message').textContent='Importazione non riuscita: nessuna riga salvata. Aggiorna l’elenco e riprova; potrebbero esserci doppioni inseriti nel frattempo.';}finally{busy=false;q('#sl-confirm').disabled=false;}
 });
 await load();return ()=>{disposed=true;disposePosition?.();map?.remove();root.innerHTML='';};
}
