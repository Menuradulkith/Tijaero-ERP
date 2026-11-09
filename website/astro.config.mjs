// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Set SITE_URL to the real domain before deploying (used for canonical links and the sitemap).
const site = process.env.SITE_URL ?? 'https://www.example.lk';

export default defineConfig({
  site,
  integrations: [sitemap()],
});
