# ODR Webapp

MVP gestionale ODR collegato a WordPress/WooCommerce.

## Scopo

ODR gestisce accessi, codici ospedalieri/convenzione, rete commerciale, import Excel di distributori/agenti e report. WordPress/WooCommerce resta responsabile di catalogo prodotti, carrello, checkout e pagamenti.

## Stack

- HTML/CSS/JavaScript statico
- Supabase Auth + Postgres
- WordPress/WooCommerce come sistema e-commerce esterno
- Deploy previsto su Vercel
- Versionamento previsto su GitHub

## Avvio locale

```bash
python3 -m http.server 5173
```

Poi apri `http://localhost:5173`.

Il file `package.json` include anche `npm run dev`, che usa lo stesso server Python.

## Configurazione iniziale

Per il prototipo statico, configura questi valori in `app.js`:

- `supabaseUrl`
- `supabasePublishableKey`
- `wooBaseUrl`
- `wooShopPath`
- `defaultValidationCode`

## Database

La migrazione iniziale e' in `supabase/migrations/001_odr_mvp_schema.sql`.

Tabelle principali:

- `profiles`
- `network_entities`
- `validation_codes`
- `code_validations`
- `woocommerce_orders`
- `wordpress_settings`

## MVP implementato

- Dashboard ODR
- Validazione codice demo
- Link verso WooCommerce con parametri `coupon` e `odr_code`
- Import rete commerciale da CSV esportato da Excel
- Report demo ordini WooCommerce
- Stato configurazione Supabase

## Prossimi passi tecnici

1. Creare progetto Supabase.
2. Applicare la migrazione SQL.
3. Configurare Supabase Auth.
4. Spostare la configurazione frontend su variabili ambiente o endpoint di configurazione.
5. Collegare API WooCommerce per import ordini e report reali.
6. Pubblicare repository su GitHub e collegarlo a Vercel.
7. Aggiungere import XLSX nativo tramite API backend o parser dedicato.
