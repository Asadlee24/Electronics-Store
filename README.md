# MDK Electronics

A product-first rebuild of [mdkelectronics.com](https://mdkelectronics.com), designed and built for Asad Lee. An ivory and sage storefront with original product photography, a perspective product showroom, restrained motion and a complete browsing-to-order-request flow.

![MDK Electronics storefront](docs/storefront-desktop.jpg)

## What's included

- 9 electronics products imported from the public WooCommerce catalogue, with original IDs, slugs, prices, stock states, descriptions and 24 gallery images.
- Original MDK logo, plus an isolated, enhanced Hikvision hero image. The original photography remains in the product gallery.
- Mouse-responsive showroom, three featured product scenes, subtle floating animation, and reduced-motion support.
- Search, category filters, price sorting, in-stock filtering, persistent wishlist and shopping bag.
- Product detail pages with image galleries, quantity selection, related products and delivery information.
- A buyer-reviewed WhatsApp order request, with exact line items, subtotal and shipping/contact details. The shop confirms delivery charges, availability and payment.
- About, contact, shipping, returns, privacy and terms pages. Existing product URLs and policy slugs are retained.
- Static HTML for every product and information page, metadata, structured data, sitemap support and a real 404 page.
- No runtime dependencies, database or paid services required.

## Run locally

Requires Node.js 20 or newer. No package installation is needed.

```bash
npm run dev
```

Open `http://localhost:4173`. The development server builds once on startup. After editing source, run `npm run build` and refresh the browser.

```bash
npm run build
npm test
```

The generated site is in `dist/`; it is intentionally not committed.

## Deploy to Vercel

Import **Asadlee24/Electronics-Store** as a new Vercel project. The included `vercel.json` sets `npm run build` and the `dist` output directory. No framework or database setup is required.

Set `SITE_URL` to the final HTTPS origin, such as `https://your-store.vercel.app` or the final custom domain, then rebuild. This enables absolute canonical URLs and the sitemap. Leave it unset for local development.

Do not point `mdkelectronics.com` to this static storefront until the order/backend decisions below are complete and any existing WordPress access has been moved to a separate hostname.

## Commerce scope

This repository migrates the **public storefront and catalogue**, not the private WordPress installation. It does not copy historical orders, customers, logins, admin accounts, payment credentials or WooCommerce checkout sessions.

The new checkout is explicitly a **WhatsApp order request**. It opens a prepared message; the buyer reviews and sends it. It neither charges a card nor creates an order in WooCommerce. Shipping is confirmed by the shop, not silently set to zero. The customer's contact/address fields are not persisted by the storefront. Bag and wishlist store product IDs and quantities in the browser.

The footer links to existing WordPress accounts for historical orders while the original site remains available. To retain automated WooCommerce orders/payments in the new storefront, a separately configured server-side commerce integration and end-to-end payment validation are still needed.

## Refresh the WordPress catalogue

```bash
npm run sync:wordpress
npm run build
npm test
```

The import script uses only public WordPress/WooCommerce read endpoints. It imports all paginated results, strips active HTML from descriptions, downloads images locally, and saves an import manifest. Run it only while the WordPress source remains available. Catalogue changes are snapshots, not live inventory synchronization; confirm availability when accepting requests.

Source files:

| File | Purpose |
| --- | --- |
| `src/catalog.json` | Product snapshot, source URLs, prices, gallery paths and stock |
| `src/pages.json` | Imported and sanitized information pages |
| `src/render.mjs` | Layout, storefront and product templates |
| `src/styles.css` | Responsive design and motion |
| `src/app.js` | Browser interactions |
| `src/store.mjs` | Cart, filtering and order-request rules |
| `scripts/import-wordpress.py` | Repeatable public-data import |
| `scripts/build.mjs` | Static page generation |
| `docs/import-manifest.json` | Source and import counts |
| `docs/VERIFICATION.md` | Checks performed and remaining migration limits |

## Content decisions

- The detailed return policy specifies **7 days for defective/damaged items**. The old homepage's conflicting 30-day/free-delivery banners were not carried over.
- The current footer/returns phone number, **+92 314 5851509**, is used consistently. The About page's stale number was corrected.
- The W-KING speaker remains **out of stock** and cannot be added to the bag.
- The stun-gun listing (source product 832) is excluded; this storefront is for electronics merchandise.
- No fabricated ratings, reviews, sales counts or payment claims are displayed.

## Artwork

`public/images/hikvision-hero-v2.png` was produced with the built-in imagegen tool from the original product photo. Prompt: remove the white background into true alpha transparency, preserve the Hikvision camera geometry, viewing angle and logo, gently improve clarity, and add no extra scene elements. This edited asset is used only in the showroom; original photos are retained for purchasing decisions.
