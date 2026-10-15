// Renders docs/beneficiary-guide.html into public/mvxvest-for-beneficiaries.pdf,
// the short guide for people who only claim (mvxsafe's signer guide is its
// counterpart). Run after editing the HTML or retaking the guide's pictures:
//   node scripts/make-beneficiary-pdf.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(`file://${here('../docs/beneficiary-guide.html')}`, {
  waitUntil: 'networkidle'
});
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: here('../public/mvxvest-for-beneficiaries.pdf'),
  format: 'A4',
  printBackground: true
});
await browser.close();
console.log('public/mvxvest-for-beneficiaries.pdf written');
