// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import sitemap from '@astrojs/sitemap';
import securityHeaders from './integrations/security-headers.mjs';

const mode = process.env.NODE_ENV === 'production' || process.argv.includes('build') ? 'production' : 'development';
const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };

// Set SITE_URL to the real domain before deploying (used for canonical links and the sitemap).
const site = env.SITE_URL || 'https://www.example.lk';

/** Origin of the demo form endpoint, allowed in the CSP's connect-src. */
/** @type {string[]} */
let demoOrigin = [];
if (env.PUBLIC_DEMO_ENDPOINT) {
  const u = new URL(env.PUBLIC_DEMO_ENDPOINT); // throws on a malformed URL: better than a silently dead form
  if (u.protocol !== 'https:' && mode === 'production') throw new Error('PUBLIC_DEMO_ENDPOINT must use https');
  demoOrigin = [u.origin];
}

// Production builds warn about anything still on a placeholder, so it is not shipped by accident.
if (mode === 'production') {
  const missing = [
    !env.SITE_URL && 'SITE_URL (canonical links and sitemap point to example.lk)',
    !env.PUBLIC_DEMO_ENDPOINT && 'PUBLIC_DEMO_ENDPOINT (the demo form cannot send)',
    !env.PUBLIC_PHONE && 'PUBLIC_PHONE (WhatsApp and call links are broken)',
    !env.PUBLIC_EMAIL && 'PUBLIC_EMAIL (footer shows hello@example.lk)',
  ].filter(Boolean);
  if (missing.length) console.warn(`\n[launch check] Not set yet, see .env.example:\n  - ${missing.join('\n  - ')}\n`);
}

export default defineConfig({
  site,
  integrations: [sitemap({ filter: (page) => !page.includes('/404') }), securityHeaders({ connect: demoOrigin })],
});
