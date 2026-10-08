import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync('app.js', 'utf8');
const extract = (name, next) => app.slice(app.indexOf(name), app.indexOf(next, app.indexOf(name)));
const fields = new Map();
const byId = id => {
  if (!fields.has(id)) fields.set(id, {setAttribute(k,v){this[k]=v},classList:{toggle(){}},value:'',checked:true, required:false,setCustomValidity(v){this.validity=v},reportValidity(){},focus(){}});
  return fields.get(id);
};
let signups = 0;
const context = vm.createContext({byId, AbortSignal, fetch:async()=>({ok:true,json:async()=>({valid:true})}), authBusy:false, supabase:{auth:{signUp:async()=>{signups++;return {data:{}}}}},showAuthMessage(){},setAuthBusy(){},setAuthMode(){},currentUser:null});
vm.runInContext(extract('function updateRegistrationCodeRequirement()', 'function passwordRecoveryErrorMessage'), context);
for (const role of ['patient','agent','center','distributor','patient']) {
  byId('register-role').value=role;
  context.updateRegistrationCodeRequirement();
  assert.equal(byId('register-code').required,role==='patient');
  byId('register-code').value='   ';
  const before=signups;
  await context.submitRegistration({preventDefault(){}});
  assert.equal(signups-before,role==='patient'?0:1);
}
byId('register-code').value='ENTE-TEST';
await context.submitRegistration({preventDefault(){}});
assert.equal(signups,4);
vm.runInContext(extract('function canAccessMarketing()', 'function applyMarketingVisibility'), context);
for (const role of ['patient','agent','distributor','center','admin',undefined]) {
  context.currentUser=role?{role}:null;
  assert.equal(context.canAccessMarketing(),['agent','distributor','center','admin'].includes(role));
}
console.log('Cliente: ENTE required including whitespace; professional registration unaffected; MKT role access OK.');

context.currentUser = null;
byId('register-role').value = 'patient';
byId('register-code').value = '0000';
byId('register-name').value = 'Nome conservato';
let busy = true;
context.setAuthBusy = value => { busy = value; };
context.supabase.auth.signUp = async () => ({data:null,error:{code:'unexpected_failure',message:'Database error saving new user'}});
await context.submitRegistration({preventDefault(){}});
assert.equal(byId('register-code-error').textContent, 'Codice errato');
assert.equal(byId('register-code')['aria-invalid'], 'true');
assert.equal(byId('register-name').value, 'Nome conservato');
assert.equal(busy, false);
context.supabase.auth.signUp = async () => { throw Error('network'); };
await context.submitRegistration({preventDefault(){}});
assert.equal(byId('register-code-error').textContent, '');
assert.equal(busy, false);
console.log('Invalid code displayed inline; data preserved; network failure releases submit button.');

context.fetch = async () => ({ok:true,json:async()=>({valid:false})});
let attempted = false;
context.supabase.auth.signUp = async () => { attempted = true; };
await context.submitRegistration({preventDefault(){}});
assert.equal(attempted, false);
assert.equal(byId('register-code-error').textContent,'Codice errato');
assert.equal(busy,false);
console.log('Code precheck blocks signup and displays Codice errato before account creation.');
