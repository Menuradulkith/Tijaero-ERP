// Capture Distributor Lanka demo screens into website/public/screens/dl-*.jpg (1440x900 @2x, like the ERP shots).
// Login from creds.json (written by seed.py, gitignored, never printed).
// Needs the demo app on :5180 (launch config "distributor-demo"). Usage: node scripts/distributor-demo/capture.mjs [name ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const D = new URL('./', import.meta.url);
const OUT = new URL('../../public/screens/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = 'http://localhost:5180';
const creds = JSON.parse(fs.readFileSync(new URL('creds.json', D), 'utf8')).owner;
const exe = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe');

const screens = {
  'dl-dashboard': { url: '/' },
  'dl-loading': { url: '/loading' },
  'dl-load-detail': { url: '/loading', open: ['role=tab[name=/Loading sheets/]', 'table tbody tr >> nth=3'] }, // an unloaded sheet
  'dl-orders': { url: '/orders' },
  'dl-reports': { url: '/reports' },
  'dl-inventory': { url: '/inventory' },
  'dl-finance': { url: '/finance' },
};
const only = process.argv.slice(2);

const b = await chromium.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Colombo' });
const p = await ctx.newPage();
await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
await p.fill('input[type=email]', creds.email);
await p.fill('input[type=password]', creds.password);
await p.keyboard.press('Enter');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

async function settle() {
  await p.waitForLoadState('networkidle');
  await p.waitForFunction(() => !document.querySelector('.animate-pulse, [data-slot="skeleton"]'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1200); // chart animations
}
for (const [name, s] of Object.entries(screens)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await p.goto(BASE + s.url); await settle();
    for (const sel of [].concat(s.open ?? [])) { await p.locator(sel).first().click(); await settle(); }
    await p.mouse.move(1430, 890);
    await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82 });
    console.log('ok', name, p.url().replace(BASE, ''));
  } catch (e) { console.log('fail', name, e.message.split('\n')[0]); }
}
await b.close();
