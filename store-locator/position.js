import L from 'leaflet';

export function mountPosition(form, client) {
  const field = name => form.elements.namedItem(name);
  const box = document.createElement('fieldset');
  box.className = 'sl-position';
  box.innerHTML = `<legend>Posizione sulla mappa</legend><button type="button" class="sl-find-position">Trova posizione dall’indirizzo</button><p>Controlla indirizzo, città e Paese prima della ricerca. Scegli un risultato, poi correggi il punto cliccando sulla mappa o trascinandolo. Premi «Salva scheda» per confermare.</p><p class="sl-position-status" role="status"></p><div class="sl-position-results"></div><div class="sl-position-map" aria-label="Controlla posizione della struttura"></div><small>Ricerca: Photon · dati © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. I risultati possono essere approssimativi: verifica il numero civico.</small>`;
  form.querySelector('#sl-fields').insertBefore(box,form.querySelector('#sl-fields fieldset'));
  const button=box.querySelector('button'), status=box.querySelector('.sl-position-status'), results=box.querySelector('.sl-position-results');
  const map=L.map(box.querySelector('.sl-position-map')).setView([42.5,12.5],5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  let marker, controller, disposed=false, version=0;
  const readAddress=()=>Object.fromEntries(['address','postcode','city','country'].map(k=>[k,field(k).value.trim()]));
  const icon=L.divIcon({className:'locator-pin',html:'<span>ODR</span>',iconSize:[38,38]});
  function showPoint(lat,lng,write=false) {
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
    if(write){field('latitude').value=lat.toFixed(6);field('longitude').value=lng.toFixed(6);status.textContent='Posizione selezionata. Premi «Salva scheda» per confermare.';}
    if(marker)marker.setLatLng([lat,lng]);else {
      marker=L.marker([lat,lng],{icon,draggable:true}).addTo(map);
      marker.on('dragend',()=>{const p=marker.getLatLng();showPoint(p.lat,p.lng,true);});
    }
    map.setView([lat,lng],17);
  }
  function syncCoordinates() {
    const a=field('latitude').value.trim(),b=field('longitude').value.trim();
    if(a!==''&&b!=='')showPoint(Number(a.replace(',','.')),Number(b.replace(',','.')));
    else if(marker){map.removeLayer(marker);marker=null;}
  }
  syncCoordinates();
  map.on('click',e=>showPoint(e.latlng.lat,e.latlng.lng,true));
  const invalidate=()=>{version++;controller?.abort();results.replaceChildren();button.disabled=false;status.textContent='Indirizzo modificato: cerca nuovamente e controlla la posizione prima di salvare.';};
  ['address','postcode','city','country'].forEach(k=>field(k).addEventListener('input',invalidate));
  ['latitude','longitude'].forEach(k=>field(k).addEventListener('change',syncCoordinates));
  button.addEventListener('click',async()=>{
    const address=readAddress();
    if(!address.address||!address.city||!address.country){status.textContent='Compila indirizzo, città e Paese, poi riprova.';return;}
    controller?.abort();controller=new AbortController();const requestController=controller;const requestVersion=++version;
    button.disabled=true;results.replaceChildren();status.textContent='Ricerca posizione…';
    const timeout=setTimeout(()=>requestController.abort(),30000);
    try {
      const {data,error}=await client.auth.getSession();
      if(error||!data.session)throw new Error('Sessione scaduta. Accedi nuovamente.');
      if(disposed||requestVersion!==version)return;
      const response=await fetch('/api/store-geocode',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(address),signal:requestController.signal});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Ricerca non riuscita. Riprova.');
      if(disposed||requestVersion!==version)return;
      status.textContent=payload.results.length?'Scegli l’indirizzo corretto tra i risultati.':'Nessun risultato. Controlla l’indirizzo oppure indica il punto sulla mappa.';
      for(const result of payload.results){const b=document.createElement('button');b.type='button';b.textContent=result.label;b.addEventListener('click',()=>{showPoint(result.latitude,result.longitude,true);results.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});results.append(b);}
    } catch(error){if(!disposed&&requestVersion===version)status.textContent=error.name==='AbortError'?'Ricerca interrotta o troppo lenta. Riprova.':error.message;}
    finally {clearTimeout(timeout);if(!disposed&&requestVersion===version)button.disabled=false;}
  });
  requestAnimationFrame(()=>{if(!disposed)map.invalidateSize();});
  return ()=>{disposed=true;version++;controller?.abort();map.remove();['address','postcode','city','country'].forEach(k=>field(k)?.removeEventListener('input',invalidate));['latitude','longitude'].forEach(k=>field(k)?.removeEventListener('change',syncCoordinates));};
}
