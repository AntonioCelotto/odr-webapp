# Checkout bonifico dentro ODR

Implementazione preparata, non attivata in produzione. `ODR_BANK_CHECKOUT_ENABLED=true` abilita il nuovo pulsante durante la build; default false conserva il checkout esistente. Il backend richiede un profilo approvato agente/distributore/centro e verifica l'appartenenza del cliente.

## Componenti
- `api/bank-checkout.js`: autentica tramite Supabase, risolve i clienti autorizzati, inoltra solo identità verificate e carrello a WordPress.
- `wordpress/odr-bank-checkout.php`: snippet separato, route privata autenticata con chiave WooCommerce in scrittura e capability manage_woocommerce. Utilizza WC_Cart per prezzi/coupon/spedizione/imposte e WC_Checkout per ordine e hooks. Sessione locale alla richiesta, carrello persistente disabilitato.
- `bank-checkout.js`: riepilogo in dialog, selezione spedizione, consenso, conferma idempotente e recupero token dopo errore/ricaricamento.

Gli ordini bonifico sono `on-hold` (non pagati). I dati bancari provengono dalla configurazione BACS WooCommerce. Le email utilizzano gli hook esistenti: verificarne destinatari e ricezione durante il collaudo reale.

## Rilascio e gate obbligatorio
1. Installare lo snippet PHP come snippet separato (omettere `<?php` nell'editor Code Snippets); il checkout esistente resta indipendente.
2. Preparare un deploy preview con variabili ambiente del progetto e flag attivo.
3. Con account test approvato verificare quote per centro, distributore proprio e agente/distributore per cliente assegnato (anche cliente app e spedizione diversa). Confrontare prezzi bundle, IVA, coupon automatici/manuali, soglie e costi spedizione con checkout WooCommerce.
4. Confermare un ordine test concordato: controllare BACS, on-hold, stock, attribution, cliente, scadenze, metadati fiscali richiesti da plugin, email e report. Non usare dati reali arbitrari.
5. Ripetere la stessa conferma: deve restituire lo stesso ordine; testare errore di rete e ricaricamento. Modificare prezzo/spedizione fra quote e conferma: deve richiedere un nuovo riepilogo.
6. Solo dopo esito positivo abilitare il flag nella build produzione. Disabilitarlo e ricostruire ripristina il percorso precedente senza modificare ordini.

## Idempotenza
Quote private, legate all'identità, scadono dopo 15 minuti. Il server ricalcola prima di scrivere. Lock atomico tramite add_option; mapping durevole del token all'ordine. Un arresto durante la creazione conserva il lock: l'amministratore deve cercare il meta `_odr_bank_request` e riconciliare l'ordine prima di rimuovere il lock. Non cancellare lock alla cieca o sostituire un token incerto con una nuova quote.

## Verifiche eseguite localmente
`node scripts/verify-bank-checkout.mjs`, build e verifica statica. Il parser PHP verifica la sintassi; non sostituisce l'esecuzione con WordPress, WooCommerce e plugin attivi. Nessun ordine reale creato da questi test.
