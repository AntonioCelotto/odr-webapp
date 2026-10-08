import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync('app.js', 'utf8');
const extract = (name, next) => app.slice(app.indexOf(name), app.indexOf(next, app.indexOf(name)));
const fields = new Map();
const byId = id => {
  if (!fields.has(id)) fields.set(id, {value:'',checked:true, required:false,setCustomValidity(v){this.validity=v},reportValidity(){},focus(){}});
  return fields.get(id);
};
let signups = 0;
const context = vm.createContext({byId, authBusy:false, supabase:{auth:{signUp:async()=>{signups++;return {data:{}}}}},showAuthMessage(){},setAuthBusy(){},setAuthMode(){},currentUser:null});
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
