# Verification — 23 October 2026

## Automated

`npm run build` emits 21 routes plus `404.html` from the imported catalogue and policies.

`npm test` covers nine meaningful cases:

1. Reject malformed, unknown and unavailable cart entries.
2. Cap quantities and calculate totals from catalogue prices.
3. Combine search, categories and stock filtering.
4. Combine wishlist filtering with price sorting.
5. Produce exact WhatsApp order-request lines and pending-confirmation wording.
6. Preserve imported product counts, original key prices and out-of-stock status.
7. Verify every local gallery asset exists.
8. Reject active imported HTML and retain the seven-day return policy.
9. Verify every internal generated link/asset resolves and every page has one primary heading.

JavaScript syntax checks and `git diff --check` also pass.

## Browser checks

- Homepage and original photography render at desktop width.
- Hero cutout renders with a transparent background; original gallery photography is retained.
- Adding Hikvision to the bag, increasing quantity to two, and continuing to the order form shows a **Rs. 6,000** product subtotal.
- Cart state persists between pages.
- Audio category shows one out-of-stock speaker; its add button is disabled.
- In-stock-only filtering produces an empty state; reset restores the collection.
- Live Hikvision search and saving the product populate the wishlist.
- A 390px mobile viewport renders without horizontal overflow; mobile navigation opens as a native modal.

No live order, WhatsApp message or payment was submitted.

## Limits

- This is a public storefront/catalogue migration, not a WordPress database, customer, order or payment migration.
- Checkout prepares a WhatsApp request for the buyer to send and the shop to confirm.
- Catalogue/inventory is an imported snapshot, not a live stock service.
- Historical WordPress accounts remain on the original site. Domain cutover must preserve or relocate WordPress if those links are still needed.
- The deployment configuration is included; the original site's DNS has not been changed.
- Device QA uses a narrow browser frame, not a physical phone.
