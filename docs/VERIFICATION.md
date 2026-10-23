# Verification — 23 October 2026

## Current story

A store owner edits a product through the admin; the browser submits to the protected API, D1 saves the product revision, and the storefront renders the new price/availability. Uploads are stored in R2 and served back as product images. Checkout requests are validated and stored for admin review before the customer continues to WhatsApp.

## Automated checks

19 tests pass. The original nine catalogue/cart/link tests remain, plus ten server and persistence tests covering:

- Anonymous, non-owner and cross-origin admin access rejection.
- Persistent product edits and stale revision rejection.
- Draft visibility and duplicate product URL rejection.
- Description escaping and photo type/path validation.
- Server-authoritative request pricing and quantities.
- Idempotent requests and rate limiting.
- Persistent request status changes and stale status rejection.
- No customer data in anonymous admin responses.

The tests execute the actual schema and SQL using SQLite through a D1-shaped adapter. The production Worker build passes.

## Browser checks

- The shorter desktop and 390px storefront render without horizontal overflow.
- The protected `/admin/` page requires sign-in when no owner identity is present.
- An isolated local QA page supplies a synthetic owner identity to the local backend only. The production admin guard remains enabled.
- Through the actual admin UI, Hikvision was changed from Rs. 3,000 to Rs. 3,100 and marked unavailable. A fresh storefront page showed Rs. 3,100 and a disabled out-of-stock button. Original price and stock were restored through the UI.
- An original camera JPEG was uploaded through the file chooser. R2 returned a `/media/…jpg` URL, and the resulting image loaded successfully in the editor. It was not saved to the product gallery.
- Product search, editor fields, category/visibility controls, photo removal, desktop navigation and the mobile editor were checked.
- Mobile admin tables keep scrolling inside the table, and the page itself does not overflow.

QA files and local test identity are excluded from publication. No production customer request, WhatsApp message or payment was submitted.

## Deployment limits

- The live app runs on Sites with D1/R2 and dispatch-owned ChatGPT identity; it is no longer a static-only Vercel deployment.
- The private audience is preserved, with owner-only admin authorization in the application.
- Historical WordPress customers, accounts and orders are not imported.
- Request status is not a payment receipt. Payments and delivery fees remain manually confirmed.
- The order list shows the latest 100 requests.
- The hosted owner's interactive sign-in is left to the owner's browser. Local owner writes and persistence were verified without weakening hosted authentication.
