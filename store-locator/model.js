export const categories = {beauty:'Centro estetico',problem_skin:'Pelli problematiche',oncology:'Estetica oncologica',hair:'Parrucchiere',distributor:'Distributore'};
export const text = value => String(value ?? '').trim();
export const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
export const identity = row => [row.name,row.address,row.city,row.country].map(normalize).join('|');
export function validate(row) {
 const errors=[];
 for(const key of ['name','address','city','country']) if(!text(row[key])) errors.push(`Campo obbligatorio: ${key}`);
 if(!Array.isArray(row.categories)||!row.categories.length||row.categories.some(c=>!categories[c])) errors.push('Tipologia non valida');
 const hasLat=row.latitude!==null&&row.latitude!==undefined&&row.latitude!=='';
 const hasLng=row.longitude!==null&&row.longitude!==undefined&&row.longitude!=='';
 if(hasLat!==hasLng) errors.push('Inserisci entrambe le coordinate');
 if(hasLat && (!Number.isFinite(Number(row.latitude))||Math.abs(Number(row.latitude))>90||!Number.isFinite(Number(row.longitude))||Math.abs(Number(row.longitude))>180)) errors.push('Coordinate non valide');
 if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push('Email non valida');
 for(const key of ['website','facebook','instagram','tiktok','youtube']) if(row[key]&&!safeUrl(row[key])) errors.push(`Link non valido: ${key}`);
 return errors;
}
export function safeUrl(value) {try { const u=new URL(text(value)); return ['https:','http:'].includes(u.protocol)?u.href:''; } catch {return '';}}
export function parseExcelRows(rows, existing=[]) {
 const header=(rows[0]||[]).map(normalize);
 const pick=(r,...names)=> {const i=header.findIndex(h=>names.includes(h));return i<0?'':text(r[i]);};
 if(!header.includes('nome')) throw new Error('Manca la colonna Nome nella prima riga.');
 const seen=new Set(existing.map(identity));
 return rows.slice(1).map((r,i)=>{
  if(!r.some(v=>text(v))) return null;
  const type=normalize(pick(r,'tipo','tipologia'));
  const cat=[];
  if(/estetic/.test(type)) cat.push('beauty');
  if(/problem/.test(type))cat.push('problem_skin');
  if(/oncolog/.test(type))cat.push('oncology');
  if(/parruc|hair/.test(type))cat.push('hair');
  if(/distrib/.test(type))cat.push('distributor');
  const coordinate=k=>{const v=pick(r,k);return v===''?null:Number(v.replace(',','.'));};
  const row={name:pick(r,'nome'),address:pick(r,'indirizzo'),postcode:pick(r,'cap'),city:pick(r,'citta'),province:pick(r,'prov','provincia'),region:pick(r,'regione'),country:pick(r,'stato','paese'),email:pick(r,'e-mail','email'),phone:pick(r,'telefono'),mobile:pick(r,'cellulare'),website:pick(r,'sito web','sito'),facebook:pick(r,'facebook'),instagram:pick(r,'instagram'),tiktok:pick(r,'tiktok'),youtube:pick(r,'yuotube','youtube'),whatsapp:pick(r,'whatsapp'),categories:cat,latitude:coordinate('latitudine'),longitude:coordinate('longitudine'),active:false,approved:false};
  const notes=[]; const warnings=[];
  for(const key of ['website','facebook','instagram','tiktok','youtube']) {
   if(/^www\./i.test(row[key])) row[key]='https://'+row[key];
   if(row[key]&&!safeUrl(row[key])) {notes.push(`${key}: ${row[key]}`);warnings.push(`Link ${key} da completare (conservato nelle note)`);row[key]='';}
  }
  const errors=validate(row);const duplicate=seen.has(identity(row));seen.add(identity(row));
  return {line:i+2,row,errors,warnings,duplicate,internal:{notes:notes.join('\n'),reference:pick(r,'agente/distributore'),contact:pick(r,'referente')}};
 }).filter(Boolean);
}
