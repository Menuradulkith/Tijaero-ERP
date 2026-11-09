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

| URL | Source |
| --- | --- |
| `/` | `src/components/views/HomeView.astro` |
| `/pricing/` | `src/components/views/PricingView.astro` |
| `/demo/` | `src/components/views/DemoView.astro` |

## Editing text

All copy lives in `src/i18n/en.ts`. Values in `[BRACKETS]` are placeholders to fill before launch:
prices, user limits, yearly discount, go-live weeks, support hours, customer quote, company name.

## Product screenshots

Every product image on the site is a real Tijaero ERP screen (`public/screens/*.jpg`, 1440×900 @2x),
shown through `src/components/Screenshot.astro` (browser frame, optional `zoom` / `focus` crop).

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
Vercel, or the existing nginx container).
