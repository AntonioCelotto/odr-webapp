import {createClient} from '@supabase/supabase-js';
import {mountLocator} from './view.js';
const config=window.__ODR_CONFIG__||{};
const root=document.getElementById('locator');
if(config.supabaseUrl&&config.supabasePublishableKey){
 const client=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 mountLocator(root,client).catch(()=>{root.textContent='Store Locator non disponibile. Riprova tra poco.';});
}else root.textContent='Store Locator non disponibile.';
