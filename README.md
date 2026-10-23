# MDK Electronics

A camera, audio and electronics storefront with a persistent store admin.

**Store:** https://mdk-electronics-preview.asadaly416.chatgpt.site

**Admin:** https://mdk-electronics-preview.asadaly416.chatgpt.site/admin/

The preview is private to its current owner. Sign in with the owner's ChatGPT account to access the admin.

![MDK Electronics storefront](docs/storefront-desktop.jpg)

## Storefront

- Short, direct storefront copy; original products, prices and photography.
- Responsive photographic showroom with subtle motion and reduced-motion support.
- Product categories, search, price sorting, stock filtering, wishlist and cart.
- Product galleries, imported policies and contact information.
- Server-rendered product pages and a live catalogue backed by Cloudflare D1.

## Admin

![Admin product management — local verification view](docs/admin-desktop.jpg)

- Dashboard using actual product and request counts.
- Add and edit products, PKR prices, original prices, categories and descriptions.
- Publish products or keep them hidden as drafts.
- Change availability and upload JPG, PNG or WebP images to R2.
- Choose the cover image, reorder/remove photos and export the catalogue as JSON.
- Review customer order requests and update pending/confirmed/dispatched/completed/cancelled statuses.
- Server-side owner authorization, same-origin write checks, input validation and optimistic revision checks.

Admin edits persist across browsers and deployments. The imported catalogue is the initial dataset; D1 overrides take precedence over it. Customer addresses are not stored in localStorage.

## Order requests

Checkout validates the catalogue price and stock on the server, saves a pending request in D1, and opens a WhatsApp message for the customer to review and send. Request references are idempotent, and repeated submissions are rate-limited. No payment is taken automatically. Payment and delivery charges are confirmed by MDK.

Historical WordPress orders, accounts and payment credentials were not imported. This admin manages the new storefront's products and requests.

## Runtime

This version uses the Sites Vinext/Cloudflare Workers integration, D1 and R2. It is no longer a static-only Vercel site. The earlier static-only deployment configuration was removed so it cannot accidentally publish an incomplete admin.

Requirements: Node.js 24 for the full test suite, or Node.js 22.13+ for the application runtime, with npm.

```bash
npm run install:ci
npm run db:generate  # only after changing the database schema
npm run build
npm test
npm run dev
```

Use the Sites build and publication workflow for the hosted app. The tracked `.openai/hosting.json` retains this Site's identity and declares its `DB` and `BUCKET` bindings. Configure `ADMIN_EMAIL` as a runtime secret matching the verified owner email. Never put its value in frontend code.

For local development, copy `.dev.vars.example` to `.dev.vars` and configure the owner identity in your local test environment. Hosted Sites authentication is dispatch-owned; the local preview does not invent an owner session. Do not expose the Worker behind an untrusted proxy that permits clients to supply identity headers.

Generate migrations with `npm run db:generate`. After building, apply each new SQL migration to the local D1 database once:

```bash
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_glorious_leo.sql
```

Hosted migrations are applied by Sites during publication. Local preview data is separate from hosted data.

## Files

| File | Purpose |
| --- | --- |
| `src/render.mjs` | Storefront templates |
| `src/app.js`, `src/styles.css` | Storefront interactions and design |
| `src/admin.js`, `src/admin.css` | Admin UI |
| `server/router.mjs` | Live storefront and protected admin routes |
| `server/api.mjs` | Products, uploads and order requests |
| `server/catalogue.mjs` | Catalogue merge, validation and authorization |
| `db/schema.ts`, `drizzle/` | Persistent schema and migrations |
| `src/catalog.json`, `src/pages.json` | Imported source content |
| `scripts/sync-assets.mjs` | Copies authored client assets for deployment |
| `docs/VERIFICATION.md` | Validation evidence and limits |

## Imported content

Nine electronics products and their galleries were imported from the public WordPress store. The stun-gun listing (832) is excluded. The detailed seven-day damaged-item return policy is preserved; conflicting homepage promises were removed. The current phone number is used consistently.

`npm run sync:wordpress` refreshes the public source snapshot and downloaded images. Existing D1 edits remain authoritative. Review imported text before publication.

The edited `public/images/hikvision-hero-v2.png` is a background-extracted showcase asset; original product photos remain in the galleries. It was created with the built-in imagegen tool using the original camera photo, preserving its geometry and branding while removing the background.
