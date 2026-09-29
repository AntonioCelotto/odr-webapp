import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('app.js','utf8').split('async function saveAgentCustomer(event) {')[1].split('\nasync function deleteAgentCustomer')[0];
for (const scenario of ['create','edit','failure','session-failure']) {
  const fields = new Map();
  const byId = id => {
    if (!fields.has(id)) fields.set(id,{ value: id.endsWith('-sdi') ? 'ABC1234' : id.endsWith('-edit-id') && scenario==='edit' ? 'app-test' : '', checked:false,focus(){} });
    return fields.get(id);
  };
  let reset=0,hidden=0,loaded=0,sent=0;
  const button={disabled:false};
  const form={querySelector:()=>button,reset(){reset++},classList:{add(){hidden++}}};
  const event={preventDefault(){},currentTarget:form};
  const context=vm.createContext({byId,document:{querySelectorAll:()=>[]},supabase:{auth:{getSession:async()=>{
    event.currentTarget=null; // Browser clears currentTarget after dispatch, before await resumes.
    if(scenario==='session-failure') throw Error('Sessione non disponibile');
    return {data:{session:{access_token:'test'}}};
  }}},fetch:async(url,options)=>{
    sent++; assert.equal(options.method,scenario==='edit'?'PUT':'POST');
    return {ok:scenario!=='failure',json:async()=>({error:'Salvataggio rifiutato'})};
  },loadAgentCustomers:async()=>{loaded++}});
  vm.runInContext('async function saveAgentCustomer(event) {'+source,context);
  await context.saveAgentCustomer(event);
  assert.equal(button.disabled,false);
  const success=['create','edit'].includes(scenario);
  assert.equal(reset,success?1:0); assert.equal(hidden,success?1:0); assert.equal(loaded,success?1:0);
  assert.equal(sent,scenario==='session-failure'?0:1);
  assert.match(byId('agent-customer-message').textContent,success?/correttamente/:scenario==='failure'?/rifiutato/:/Sessione/);
}
const html=fs.readFileSync('index.html','utf8');
assert.ok(html.indexOf('id="agent-customer-company"')<html.indexOf('id="agent-customer-name"'));
console.log('Customer form: create/edit after async dispatch, failures and field order OK');
