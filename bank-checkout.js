// In-app checkout: the browser never supplies prices, shipping costs or order status.
export function createBankCheckout({ api, userId, clearCart, escape, money }) {
  let quote = null;
  let payload = null;
  let busy = false;
  let notesDirty = false;
  const paymentLabels = {bacs:'Bonifico bancario',bacs_30:'Bonifico bancario a 30 giorni',bacs_60:'Bonifico bancario a 60 giorni',bacs_90:'Bonifico bancario a 90 giorni',cod:'Contrassegno',bacs_advance:'Bonifico anticipato — sconto 2% sui prodotti'};
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
  function paymentSchedule(data = quote) {
    const option = data.paymentOption;
    const days = option === 'bacs' ? (data.paymentTerms || []) : /^bacs_\d+$/.test(option) ? [Number(option.slice(5))] : [];
    if (!days.length) return `<p class="checkout-payment-summary"><strong>${escape(paymentLabels[option] || 'Bonifico bancario')}</strong><span>${money(data.total)}</span></p>`;
    const cents = Math.round(Number(data.total) * 100);
    const part = Math.floor(cents / days.length);
    return `<p><strong>Bonifico bancario — ${days.join(' / ')} giorni</strong></p><ul>${days.map((day, i) => `<li>${day} giorni — ${money((i === days.length - 1 ? cents - part * i : part) / 100)}</li>`).join('')}</ul>`;
  }
  function renderQuote() {
    shell(`<p>Controlla il riepilogo prima di confermare.</p>
      <p>${escape(payload.address.firstName)} ${escape(payload.address.lastName)} · ${escape(payload.address.address1)}, ${escape(payload.address.postcode)} ${escape(payload.address.city)}</p>
      <ul>${quote.lines.map(l=>`<li>${escape(l.name)} × ${l.quantity} — ${money(Number(l.total)+Number(l.tax))}</li>`).join('')}</ul>
      <dl><dt>Subtotale prodotti, IVA esclusa</dt><dd>${money(quote.productsNet ?? (Number(quote.subtotal)-Number(quote.discount)+Number(quote.fees)))}</dd>
      <dt>Spedizione, IVA esclusa</dt><dd>${money(quote.shipping)}</dd>
      ${Number(quote.advanceDiscount) ? `<dt>Sconto bonifico anticipato (2%)</dt><dd>− ${money(quote.advanceDiscount)}</dd>` : ''}
      ${Number(quote.adjustments) ? `<dt>Altri costi, IVA esclusa</dt><dd>${money(quote.adjustments)}</dd>` : ''}
      <dt><strong>Totale imponibile</strong></dt><dd><strong>${money(Number(quote.total)-Number(quote.tax))}</strong></dd>
      <dt>IVA</dt><dd>${money(quote.tax)}</dd><dt><strong>Totale acquisto / fattura</strong></dt><dd><strong>${money(quote.total)}</strong></dd></dl>
      ${(quote.shippingOptions || []).map((rates,i)=>`<label>Metodo di spedizione<select data-shipping="${i}">${rates.map(r=>`<option value="${escape(r.id)}" ${quote.shippingMethods[i]===r.id ? 'selected' : ''}>${escape(r.label)}</option>`).join('')}</select></label>`).join('')}
      <label>Modo di pagamento<select data-payment>${Object.entries(paymentLabels).map(([value,label])=>`<option value="${value}" ${quote.paymentOption===value?'selected':''}>${value === 'bacs' && quote.paymentTerms?.length ? `Bonifico bancario a ${quote.paymentTerms.join(' / ')} giorni` : label}</option>`).join('')}</select></label>
      ${paymentSchedule()}
      <label>Note ordine<textarea data-notes maxlength="2000" rows="3" placeholder="Indicazioni per l’ordine o la consegna">${escape(payload.orderNotes || '')}</textarea></label>
      ${quote.paymentOption==='cod' ? '<p>Pagamento alla consegna tramite contrassegno.</p>' : bank(quote.bank)}
      <label><input type="checkbox" data-consent> Confermo i dati e la modalità di pagamento selezionata.</label>`,
      '<button type="button" data-close>Torna al carrello</button><button type="button" data-confirm disabled>Conferma ordine</button>');
  }
  async function calculate() {
    busy = true; quote = null;
    shell('<p role="status">Calcolo spedizione e totale…</p>','');
    try { quote = await api({...payload,action:'quote'}); notesDirty = false; renderQuote(); }
    catch(e) { shell(`<p>${escape(e.message)}</p>`,'<button type="button" data-close>Torna al carrello</button><button type="button" data-recalculate>Riprova</button><button type="button" data-reset-payment>Usa bonifico bancario</button>'); }
    finally { busy = false; }
  }
  async function confirm() {
    if (busy) return;
    if (!pending() && notesDirty) { await calculate(); return; }
    const token = pending() || quote?.quoteToken;
    if (!token) return;
    // Persist before sending. A reload/retry uses the same token, never a new order.
    localStorage.setItem(storageKey(),token);
    busy = true;
    shell('<p role="status">Conferma ordine in corso…</p>','');
    try {
      const order = await api({action:'confirm',quoteToken:token});
      localStorage.removeItem(storageKey()); clearCart(); quote = null;
      shell(`<h3>Ordine ${escape(String(order.orderNumber || order.orderId))} ricevuto</h3><p>Totale: <strong>${money(order.total)}</strong></p>${paymentSchedule(order)}${order.paymentOption==='cod' ? '' : bank(order.bank)}`,'<button type="button" data-close>Chiudi</button>');
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
  dialog.addEventListener('input',e=>{
    if(e.target.matches('[data-notes]')) { payload.orderNotes=e.target.value; notesDirty=true; dialog.querySelector('[data-confirm]').textContent='Aggiorna riepilogo'; }
  });
  dialog.addEventListener('change',e=>{
    if(e.target.matches('[data-payment]') && !busy) { payload.paymentOption=e.target.value; calculate(); }
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
    if (e.target.closest('[data-reset-payment]')) { payload.paymentOption='bacs'; calculate(); }
    if (e.target.closest('[data-confirm]')) confirm();
  });
  return async function open(data) {
    if (busy) return;
    payload = {...structuredClone(data),paymentOption:'bacs',orderNotes:data.orderNotes || ''}; notesDirty=false;
    if (!dialog.open) dialog.showModal();
    if (pending()) {
      shell('<p>È presente una conferma da verificare. Controllala prima di inviare un altro ordine.</p>','<button type="button" data-close>Chiudi</button><button type="button" data-confirm>Verifica conferma</button>');
    } else await calculate();
  };
}
