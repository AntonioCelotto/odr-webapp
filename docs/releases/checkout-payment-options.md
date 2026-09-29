# Checkout payment options

Prepared for review; production requires coordinated WordPress + Vercel release.

## Changes
- Summary: products net of existing discounts, shipping ex VAT, advance discount if selected, other charges if any, taxable total, VAT, invoice total.
- Payment options: existing BACS (compatibility), BACS 30/60/90 days, COD, BACS advance with 3% discount.
- Advance discount calculated by WooCommerce on net product value after coupon/negative fee reductions, excluding shipping and positive charges. VAT allocated across product classes only.
- Notes sanitized and frozen with the quote; edits require refreshed quote and renewed confirmation.
- Saved payment method/title, `_odr_payment_option`, `_odr_payment_terms`, customer note. Orders remain unpaid/on-hold.
- COD availability uses WooCommerce's existing gateway/shipping restrictions; no gateway settings changed.
- Quote/actor binding, lock and repeat-confirm behavior retained.

## Release sequence
1. Back up Code Snippets snippet 84 on odr.ioxina.com.
2. Replace snippet with wordpress/odr-bank-checkout.php (omit opening PHP tag in Code Snippets).
3. Check a quote for every option in the preview, shipping unchanged by the advance discount, totals and notes. Do not create a real order without explicit test authorization.
4. Publish frontend/API after successful quote checks. New API requires checkoutVersion 2 to prevent old backend silently ignoring the payment selection.
5. Verify actual confirmed order fields only with an authorized test order.

## Verification completed
- Node API checks: authentication, roles, trusted identity, quantities, all payment choices, note forwarding, ignored client discount/prices, token-only confirmation.
- Simulated UI: total ordering, recalculation, note preservation and escaping, COD instructions, confirmation/cart clearing.
- Isolated PHP 8.3 test: 510 - 255 role discount => 7.65 advance discount; positive charge excluded; mixed VAT and exemption; payment days and COD mapping.
- Static build and verifier.

Pending: actual WooCommerce gateway/plugin integration after updating snippet; actual test order (not created).
