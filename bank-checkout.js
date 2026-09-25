// In-app checkout: the browser never supplies prices, shipping costs or order status.
export function createBankCheckout({ api, userId, clearCart, escape, money }) {
  let quote = null;
  let payload = null;
  let busy = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'bank-checkout-dialog';
  dialog.setAttribute('aria-label','Riepilogo e conferma ordine');
  document.body.append(dialog);
  const storageKey = () => `odr-bank-pending:${userId()}`;
  const pending = () => localStorage.getItem(storageKey());
  function bank(data) {
    return `<h3>Bonifico bancario</h3><p>${escape(data?.instructions || 'Indica il numero ordine nella causale del bonifico.')}</p>${(data?.accounts || []).map(a=>`<p><strong>${escape(a.account_name || '')}</strong><br>${escape(a.bank_name || '')}<br>IBAN: ${escape(a.iban || a.account_number || '')}${a.bic ? `<br>BIC: ${escape(a.bic)}` : ''}</p>`).join('')}`;
  }
  function shell(content, actions) {
    dialog.innerHTML = `<h2>Il tuo ordine</h2>${content}<p class="bank-checkout-error" role="alert"></p><div class="bank-checkout-actions">${actions}</div>`;
  }
  function renderQuote() {
    shell(`<p>Controlla il riepilogo prima di confermare. L’ordine resterà in attesa di pagamento.</p>
      <p>${escape(payload.address.firstName)} ${escape(payload.address.lastName)} · ${escape(payload.address.address1)}, ${escape(payload.address.postcode)} ${escape(payload.address.city)}</p>
      <ul>${quote.lines.map(l=>`<li>${escape(l.name)} × ${l.quantity} — ${money(Number(l.total)+Number(l.tax))}</li>`).join('')}</ul>
      ${(quote.shippingOptions || []).map((rates,i)=>`<label>Spedizione ${i+1}<select data-shipping="${i}">${rates.map(r=>`<option value="${escape(r.id)}" ${quote.shippingMethods[i]===r.id ? 'selected' : ''}>${escape(r.label)} — ${money(r.total)} IVA inclusa</option>`).join('')}</select></label>`).join('')}
      <dl><dt>Prodotti, IVA esclusa</dt><dd>${money(quote.subtotal)}</dd><dt>Sconto, IVA esclusa</dt><dd>− ${money(quote.discount)}</dd><dt>Spedizione, IVA esclusa</dt><dd>${money(quote.shipping)}</dd>${Number(quote.fees) ? `<dt>Altri costi, IVA esclusa</dt><dd>${money(quote.fees)}</dd>` : ''}<dt>IVA totale</dt><dd>${money(quote.tax)}</dd><dt><strong>Totale ordine</strong></dt><dd><strong>${money(quote.total)}</strong></dd></dl>${bank(quote.bank)}
      <label><input type="checkbox" data-consent> Confermo i dati e l’ordine con pagamento tramite bonifico.</label>`,
      '<button type="button" data-close>Torna al carrello</button><button type="button" data-confirm disabled>Conferma ordine</button>');
  }
  async function calculate() {
    busy = true; quote = null;
    shell('<p role="status">Calcolo spedizione e totale…</p>','');
    try { quote = await api({...payload,action:'quote'}); renderQuote(); }
    catch(e) { shell(`<p>${escape(e.message)}</p>`,'<button type="button" data-close>Torna al carrello</button><button type="button" data-recalculate>Riprova</button>'); }
    finally { busy = false; }
  }
  async function confirm() {
    if (busy) return;
    const token = pending() || quote?.quoteToken;
    if (!token) return;
    // Persist before sending. A reload/retry uses the same token, never a new order.
    localStorage.setItem(storageKey(),token);
    busy = true;
    shell('<p role="status">Conferma ordine in corso…</p>','');
    try {
      const order = await api({action:'confirm',quoteToken:token});
      localStorage.removeItem(storageKey()); clearCart(); quote = null;
      shell(`<h3>Ordine ${escape(String(order.orderNumber || order.orderId))} ricevuto</h3><p>Totale: <strong>${money(order.total)}</strong></p><p>In attesa di pagamento tramite bonifico. Causale: ordine ${escape(String(order.orderNumber || order.orderId))}.</p>${bank(order.bank)}`,'<button type="button" data-close>Chiudi</button>');
    } catch(e) {
      if (['quote_expired','quote_changed'].includes(e.code)) {
        localStorage.removeItem(storageKey());
        shell(`<p>${escape(e.message)}</p>`,'<button type="button" data-close>Torna al carrello</button><button type="button" data-recalculate>Ricalcola</button>');
      } else {
        shell(`<p>${escape(e.message)}</p><p>La conferma va verificata. Riprovando controlliamo lo stesso ordine, senza duplicarlo.</p>`,'<button type="button" data-close>Chiudi</button><button type="button" data-confirm>Verifica conferma</button>');
      }
    } finally { busy = false; }
  }
  dialog.addEventListener('cancel',e=>{ if(busy) e.preventDefault(); });
  dialog.addEventListener('change',e=>{
    if (e.target.matches('[data-consent]')) dialog.querySelector('[data-confirm]').disabled = !e.target.checked;
    if (e.target.matches('[data-shipping]') && !busy) {
      payload.shippingMethods = [...quote.shippingMethods];
      payload.shippingMethods[Number(e.target.dataset.shipping)] = e.target.value; calculate();
    }
  });
  dialog.addEventListener('click',e=>{
    if (busy) return;
    if (e.target.closest('[data-close]')) dialog.close();
    if (e.target.closest('[data-recalculate]')) calculate();
    if (e.target.closest('[data-confirm]')) confirm();
  });
  return async function open(data) {
    if (busy) return;
    payload = structuredClone(data);
    if (!dialog.open) dialog.showModal();
    if (pending()) {
      shell('<p>È presente una conferma da verificare. Controllala prima di inviare un altro ordine.</p>','<button type="button" data-close>Chiudi</button><button type="button" data-confirm>Verifica conferma</button>');
    } else await calculate();
  };
}
