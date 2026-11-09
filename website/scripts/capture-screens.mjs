// Captures the real Tijaero ERP screens used on the website from the DEMO stack
// (launch configs backend-demo :8031 + frontend-demo :3002, data from backend/scripts/seed_demo_lk.py).
//
//   npm run screens               # all screens -> public/screens/*.jpg
//   npm run screens -- vat-return # just one
//
// Needs Chromium: set CHROME_PATH, or it uses the Playwright cache (npx playwright-core install chromium).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = process.env.CHROME_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe');
const out = fileURLToPath(new URL('../public/screens/', import.meta.url));
const base = process.env.BASE || 'http://localhost:3002';
const only = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });

// The demo admin is created by backend/scripts/ensure_admin.py; read its password from there.
const ensure = fs.readFileSync(new URL('../../backend/scripts/ensure_admin.py', import.meta.url), 'utf8');
const pass = (ensure.match(/get_password_hash\(["']([^"']+)["']\)/) || ensure.match(/password\s*=\s*["']([^"']+)["']/))[1];

const pages = [
  ['dashboard', '/dashboard'],
  ['sales-dashboard', '/sales/dashboard'],
  ['sales-orders', '/sales/orders'],
  ['quotations', '/sales/quotations'],
  ['customers', '/sales/customers'],
  ['purchase-orders', '/purchasing/orders'],
  ['grn', '/purchasing/grn'],
  ['transfers', '/warehouse/item-transfer-notes'],
  ['general-ledger', '/finance/general-ledger'],
  ['income-statement', '/finance/income-statement'],
  ['vat-return', '/finance/vat-return', async (p) => {
    // show October, a closed period with output and input VAT
    const inputs = p.locator('input[placeholder], input[type="text"]');
    await inputs.nth(0).fill('01/10/2026').catch(() => {});
  }],
  ['customer-payments', '/finance/customer-payments'],
  ['payroll', '/hr/payroll'],
  ['payroll-processing', '/hr/payroll-processing'],
  ['employees', '/hr/employees'],
  ['report-receivables', '/reporting', async (p) => {
    await p.getByText('Receivables aging', { exact: true }).first().click();
    await p.waitForTimeout(1500);
    const run = p.getByRole('button', { name: /run|generate|view/i }).first();
    if (await run.count()) await run.click().catch(() => {});
  }],
  ['report-sales-by-customer', '/reporting', async (p) => {
    await p.getByText('Sales by customer', { exact: true }).first().click();
    await p.waitForTimeout(1500);
    const run = p.getByRole('button', { name: /run|generate|view/i }).first();
    if (await run.count()) await run.click().catch(() => {});
  }],
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await ctx.newPage();

await page.goto(base + '/login');
await page.getByLabel('Username').fill('admin');
await page.locator('input[type="password"]').fill(pass);
await page.keyboard.press('Enter');
await page.waitForURL(/dashboard/, { timeout: 30000 });

for (const [name, url, act] of pages) {
  if (only.length && !only.includes(name)) continue;
  try {
    await page.goto(base + url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
    if (act) { await act(page); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(2500); }
    await page.mouse.move(1430, 890); // no hover states in the shot
    await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
    console.log('ok', name);
  } catch (e) {
    console.log('fail', name, e.message.split('\n')[0]);
  }
}
await browser.close();
