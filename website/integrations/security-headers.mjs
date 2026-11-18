// Writes dist/_headers (read by Netlify and Cloudflare Pages) after every build:
// a strict Content-Security-Policy plus the usual hardening headers.
// Astro inlines small scripts into the HTML, so the CSP allows exactly those scripts by their
// SHA-256 hash, recomputed on each build. Any other inline or injected script is blocked.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** @param {{ connect?: string[] }} opts extra origins the page may fetch (the demo form endpoint) */
export default function securityHeaders(opts = {}) {
  return {
    name: 'security-headers',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const hashes = new Set();
        for (const file of await htmlFiles(root)) {
          const html = await readFile(file, 'utf8');
          for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
            if (!m[1].trim()) continue;
            hashes.add(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
          }
        }
        const connect = ["'self'", ...(opts.connect ?? [])].join(' ');
        const csp = [
          "default-src 'self'",
          `script-src 'self' ${[...hashes].join(' ')}`,
          "style-src 'self' 'unsafe-inline'", // inline style attributes and Astro's small inlined CSS
          "img-src 'self' data:",
          "font-src 'self'",
          `connect-src ${connect}`,
          "form-action 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          'upgrade-insecure-requests',
        ].join('; ');
        const headers = `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;
        await writeFile(path.join(root, '_headers'), headers);
        logger.info(`wrote _headers (${hashes.size} inline script hashes, connect-src ${connect})`);
      },
    },
  };
}
