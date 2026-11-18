import type { APIRoute } from 'astro';

// Allow everything and point crawlers at the sitemap made by @astrojs/sitemap.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('sitemap-index.xml', site).href;
  return new Response(`User-agent: *
Allow: /

Sitemap: ${sitemap}
`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
