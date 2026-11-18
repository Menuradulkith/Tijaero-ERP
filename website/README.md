# Tijaero ERP — marketing website

English sales site for Tijaero ERP, written for Sri Lankan businesses (LKR, VAT, EPF/ETF, APIT, island-wide branches).
Built with [Astro](https://astro.build) as a fully static site: plain HTML/CSS with a few small scripts, no framework runtime.

Design source: the Claude Design canvas "Tijaero ERP Website" (Home, Pricing, Book a demo).
Colors follow the product theme in `frontend/src/styles/theme.ts` (plum `#714B67`).

## Run

```bash
cd website
npm install
npm run dev        # http://localhost:4321
npm run build      # type-check + static build into dist/
npm run preview    # serve dist/
```

## Pages

| URL | Source | Copy in `en.ts` |
| --- | --- | --- |
| `/` company home | `src/components/views/HomeView.astro` | `home` |
| `/erp/` Tijaero ERP | `src/components/views/ErpView.astro` | `erp` |
| `/pos/` Tijaero POS | `src/components/views/ProductView.astro` | `pos` |
| `/distribution/` Distributor Lanka | `src/components/views/ProductView.astro` | `dist` |
| `/pricing/` | `src/components/views/PricingView.astro` | `pricing` |
| `/demo/` | `src/components/views/DemoView.astro` | `demo` (`?product=erp\|pos\|distributor` preselects) |
| `/privacy/`, `/terms/` | `src/components/views/LegalView.astro` | `legal` (drafts, need legal review) |

Search the site for `[CONFIRM` to find claims that still need checking (mostly the POS page), and for
`[` generally to find placeholders. Product pages without a real screenshot yet use `ShotPlaceholder.astro`.

## Editing text

All copy lives in `src/i18n/en.ts`. Values in `[BRACKETS]` are placeholders to fill before launch:
prices, user limits, yearly discount, go-live weeks, support hours, customer quote, company name.

## Motion

`src/scripts/motion.ts` plus the "motion" section of `src/styles/global.css`: a staggered hero entrance,
scroll reveal, hover lift on cards, a cursor spotlight inside cards and a glow on dark sections, and tab fades.
Product screenshots settle in from a tilted angle with one light sweep across the screen, then tilt in 3D
toward the cursor with a soft glare (small crops inside cards, `.tile-shot`, are left still).
Cursor effects only run with a mouse; everything is switched off for visitors who ask for reduced motion.
Timings and colours are the `--dur-*`, `--ease-*`, `--spot*` and `--glow` tokens at the top of `global.css`.

## Product screenshots

Every product image on the site is a real screen (`public/screens/*.jpg`, 1440×900 @2x),
shown through `src/components/Screenshot.astro` (browser frame, optional `zoom` / `focus` crop).
The `dl-*.jpg` screens are Distributor Lanka; how to rebuild them is in `scripts/distributor-demo/README.md`.
The ones below are Tijaero ERP.

They are captured from a separate **demo database** (`erp_demo`) filled with Sri Lankan sample data:
five branches (Colombo, Kandy, Galle, Kurunegala, Jaffna), 18 customers, 6 suppliers, 14 staff, ~5 weeks
of sales, purchases, collections, VAT, transfers and two payroll months, all created through the real API.

```bash
# 1. build the demo database (drops and recreates erp_demo only; ~20 min)
cd backend
python scripts/seed_demo_lk.py --reset
python scripts/seed_demo_lk.py
# 2. start launch configs "backend-demo" (:8031) and "frontend-demo" (:3002)
# 3. re-capture
cd ../website
npm run screens                 # or: npm run screens -- vat-return
```

The demo login is the admin account created by `backend/scripts/ensure_admin.py` (renamed to Nimal Perera).
Note: the demo data is dated around 7 Nov 2026 ("today" when it was seeded), so dashboards that show
"today" or "this month" look best when captured soon after seeding.

## Configuration (`.env`, see `.env.example`)

| Variable | Purpose |
| --- | --- |
| `SITE_URL` | Real domain. Used for canonical URLs and `sitemap-index.xml`. |
| `PUBLIC_DEMO_ENDPOINT` | URL the demo form POSTs JSON to (Formspree, a webhook, or your own API). |
| `PUBLIC_PHONE` | Phone / WhatsApp number shown on the site. |
| `PUBLIC_EMAIL` | Contact email shown in the footer. |

### Demo form payload

```json
{
  "name": "…", "company": "…", "phone": "+94771234567", "email": null,
  "province": "…", "branches": "2–5", "businessType": "…", "demoLanguage": "si",
  "modules": ["…"], "submittedAt": "2026-11-07T12:00:00.000Z"
}
```

Phone numbers are normalized to `+94XXXXXXXXX`. A hidden `website` field catches bots.
Without `PUBLIC_DEMO_ENDPOINT`, dev mode logs the payload and shows the thank-you state; a production
build shows the "please call us" error instead, so a missing endpoint is never silent.

## Deploy

`npm run build` outputs static files in `dist/`. Any static host works (Netlify, Cloudflare Pages,
Vercel, or the existing nginx container). A production build prints a `[launch check]` list of any
`.env` values still on placeholders.

## Security

- `integrations/security-headers.mjs` writes `dist/_headers` on every build: a strict Content-Security-Policy
  (scripts allowed only by SHA-256 hash, no third-party origins except the demo endpoint), HSTS, `nosniff`,
  `X-Frame-Options: DENY`, Referrer-Policy and Permissions-Policy. Netlify and Cloudflare Pages read this
  file automatically; on nginx or Vercel copy the same headers into that host's config after each build
  (the script hashes change when scripts change).
- Fonts are self-hosted (`@fontsource-variable/*`), so visitors' browsers make no requests to Google.
- The demo form posts JSON only to `PUBLIC_DEMO_ENDPOINT` (must be https), trims and caps every field,
  times out after 15 s, and uses `method="post"` so a script failure can never put personal data in the URL.
  The endpoint itself should still validate input and rate-limit: the honeypot only stops simple bots.
- Run `npm audit` before each release.
