// The pictures of /guide, taken from the live site with a real wallet.
//
//   node scripts/capture/guide.mjs                 all pictures
//   FROM=15 node scripts/capture/guide.mjs         from a given picture on
//   ONLY=1,2,3 node scripts/capture/guide.mjs      just those pictures
//
// A Chrome window opens with an orange banner along the bottom saying what to
// do. The script fills in every form itself and photographs each state as soon
// as it appears; a person only connects the wallet and approves four times in
// xPortal: one creation, one CSV of two transactions, one Claim all and one
// cancel. Everything happens on devnet (play money), in the creator's devnet
// wallet; the test network's strip is hidden in the pictures, and the guide
// says the pictures come from the test network.
//
// The guide is public: the wallets are named only by their shortened address.
//
// NOTHING IS SIGNED BY THIS SCRIPT. It fills forms, waits and photographs.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const SITE = process.env.SITE || 'https://devnet.mvxvest.io';
/** The real FOXSY token page, for the issuer's powers: mainnet, read only. */
const MAINNET = 'https://mvxvest.io';
const OUT = process.env.OUT || 'public/shots/';
const PROFILE = `${homedir()}/.mvxvest-shots-profile`;
const LAST = 23;
const ONLY = process.env.ONLY
  ? new Set(process.env.ONLY.split(',').map(Number))
  : null;
const FROM = Number(process.env.FROM || (ONLY ? Math.min(...ONLY) : 1));
const TO = Number(process.env.TO || (ONLY ? Math.max(...ONLY) : LAST));
const wanted = (n) => n >= FROM && n <= TO && (!ONLY || ONLY.has(n));
// A phase runs when one of its own pictures is wanted (ONLY may skip around).
const phase = (first, last) => {
  for (let n = first; n <= last; n++) if (wanted(n)) return true;
  return false;
};
/** The creator: the devnet xPortal wallet it connects with. */
const YOU = 'erd1eg8syhxp8e0535zh8vny9z47f2esft2tm0m0a5wlhdgee8wx380s9kje85';
const TEAMMATE =
  'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
const ADVISOR =
  'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const TOKEN = 'TFOX-d61b09';

mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: process.env.HEADLESS === '1',
  viewport: { width: 1366, height: 900 },
  deviceScaleFactor: 2,
  args: ['--ozone-platform=x11'],
  env: { ...process.env, QT_QPA_PLATFORM: 'xcb' }
});
const page = ctx.pages()[0] || (await ctx.newPage());

// --- the banner ---------------------------------------------------------------

let banner = { text: '', tone: 'ask' };
const drawBanner = () =>
  page
    .evaluate(({ text, tone }) => {
      let bar = document.getElementById('shot-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'shot-bar';
        bar.style.cssText =
          'position:fixed;inset:auto 0 0 0;z-index:99999;padding:14px 18px;font:600 15px system-ui;text-align:center';
        document.body.appendChild(bar);
      }
      bar.style.background = tone === 'ok' ? '#123d1c' : '#FF6E0A';
      bar.style.color = tone === 'ok' ? '#b8f5c7' : '#1a0d00';
      bar.textContent = text;
      bar.style.display = 'block';
    }, banner)
    .catch(() => {});

const say = async (text, tone = 'ask') => {
  banner = { text, tone };
  console.log(`>>> ${text}`);
  await drawBanner();
};

// Polled with evaluate, never waitForFunction: the site's content policy
// forbids evaluating strings, which is how waitForFunction works.
const until = async (fn, arg, label, timeout = 900000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(fn, arg)) return true;
    } catch {
      // mid navigation
    }
    await drawBanner();
    await page.waitForTimeout(800);
  }
  console.log(`    gave up waiting for ${label}`);
  return false;
};

// Functions passed to `until` run in the page, so each stands alone.
const hasText = (needle) => document.body.innerText.includes(needle);
const matches = (source) => new RegExp(source).test(document.body.innerText);
const deepText = (needle) => {
  const walk = (root) =>
    [...root.querySelectorAll('*')].some(
      (el) =>
        el.shadowRoot &&
        (el.shadowRoot.textContent.includes(needle) || walk(el.shadowRoot))
    );
  return document.body.innerText.includes(needle) || walk(document);
};
const connected = () =>
  Boolean(document.querySelector('[aria-label="Disconnect"]'));
const connectedAs = (address) =>
  Boolean(document.querySelector('[aria-label="Disconnect"]')) &&
  Boolean(document.querySelector(`[title^="${address}"]`));
const buttonEnabled = (name) =>
  [...document.querySelectorAll('button')].some(
    (b) => b.textContent.trim().startsWith(name) && !b.disabled
  );

/** The test network's strip, hidden in the pictures (the guide says where they come from). */
const hideStrip = () =>
  page
    .evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        if (
          /^devnet: test network/i.test(el.textContent.trim()) &&
          el.children.length === 0
        )
          el.style.display = 'none';
      }
    })
    .catch(() => {});

/** Photographs the window with the banner hidden; `section` scrolls to a heading first. */
const shot = async (name, section) => {
  const number = Number(name.slice(0, 2));
  if (!wanted(number)) return;
  if (section) {
    await page.evaluate((start) => {
      const target = [
        ...document.querySelectorAll('h1, h2, h3, dt, p, div')
      ].find(
        (el) => el.children.length < 4 && el.innerText.trim().startsWith(start)
      );
      if (target)
        window.scrollTo(
          0,
          target.getBoundingClientRect().top + window.scrollY - 90
        );
    }, section);
    await page.waitForTimeout(600);
  }
  // A resting pointer opens tooltips: park it on the page margin first.
  await page.mouse.move(6, 450);
  await hideStrip();
  await page.evaluate(() => {
    const bar = document.getElementById('shot-bar');
    if (bar) bar.style.display = 'none';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await drawBanner();
  console.log(`    saved ${OUT}${name}.png`);
};

const go = async (path, site = SITE) => {
  await page.goto(`${site}${path}`, { waitUntil: 'networkidle' });
  await drawBanner();
};
const button = (name) => page.getByRole('button', { name, exact: true });
const field = (label) => page.getByLabel(label, { exact: true });

/** A date for the form's datetime-local fields, `days` from now. */
const localDate = (days) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

console.log(
  `\nSite: ${SITE}. Follow the orange banner in the Chrome window.\n`
);
await go('/');

// --- 1. Connect (picture 5) -----------------------------------------------------

if (phase(5, 21)) {
  if (!(await page.evaluate(connectedAs, YOU))) {
    if (await page.evaluate(connected)) {
      await say('Another wallet is connected: disconnecting it.', 'ok');
      await page.locator('[aria-label="Disconnect"]').click();
      await until(
        () => !document.querySelector('[aria-label="Disconnect"]'),
        null,
        'the disconnect',
        60000
      );
    }
    await say(
      'Press Connect, then WAIT a second before choosing xPortal, so the chooser can be photographed. Connect your DEVNET wallet erd1eg8s…kje85.'
    );
    await until(
      (needle) => {
        const walk = (root) =>
          [...root.querySelectorAll('*')].some(
            (el) =>
              el.shadowRoot &&
              (el.shadowRoot.textContent.includes(needle) ||
                walk(el.shadowRoot))
          );
        return (
          walk(document) ||
          Boolean(document.querySelector('[aria-label="Disconnect"]'))
        );
      },
      'xPortal',
      'the wallet chooser'
    );
    if (await page.evaluate(deepText, 'xPortal')) {
      await page.waitForTimeout(400);
      await shot('05-connect');
    }
    await say(
      'Connect your devnet wallet erd1eg8s…kje85 with xPortal. I am waiting.'
    );
    await until(connectedAs, YOU, 'the wallet to connect');
  }
  await say('Connected. Filling in the forms and photographing.', 'ok');
}

// --- 2. Create one by one (pictures 6 to 14) ------------------------------------

if (phase(6, 14)) {
  await go('/create');
  await until(hasText, 'The token to lock', 'the token list', 120000);
  await page.locator('select').first().selectOption(TOKEN);
  await page.waitForTimeout(1500);
  await shot('06-create-token', 'Token');

  const rows = [
    [YOU, '12000'],
    [TEAMMATE, '6000'],
    [ADVISOR, '3000']
  ];
  for (const [index, [address, amount]] of rows.entries()) {
    if (index > 0) await button('Add a beneficiary').click();
    await page
      .getByPlaceholder('erd1... beneficiary address')
      .nth(index)
      .fill(address);
    await page.locator('input[placeholder^="Amount"]').nth(index).fill(amount);
  }
  await page.getByText('Beneficiaries', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await shot('07-create-rows', 'Beneficiaries');

  // Every shape, for the pictures; the last one is the one created.
  await field('How the rest is released').selectOption('linear');
  await field('End').fill(localDate(730));
  await page.waitForTimeout(1200);
  await shot('08-schedule-linear', 'Schedule');

  await field('How the rest is released').selectOption('tranches');
  await page.waitForTimeout(1200);
  await shot('09-schedule-dates', 'Schedule');

  await field('Cliff').selectOption('lump');
  await field('Cliff date').fill(localDate(91));
  await field('Share unlocked at the cliff (%)').fill('10');
  await field('How the rest is released').selectOption('months');
  await field('Every how many months').fill('1');
  await field('Number of releases').fill('12');
  await page.waitForTimeout(1200);
  await shot('10-schedule-months', 'Schedule');

  await page.getByRole('button', { name: /^Cancelable/ }).click();
  await field('Label (optional)').fill('Team 2027');
  await page.waitForTimeout(800);
  await shot('11-options', 'Options');
  await shot('12-review', 'Review and sign');

  await button('Check and sign').click();
  await until(hasText, 'Checked with the network', 'the network check', 180000);
  await page.waitForTimeout(800);
  await shot('13-checked', 'Review and sign');

  await say(
    'Press "Sign in your wallet" and approve in xPortal (one creation of 3 vestings).'
  );
  await until(matches, 'Created 3 vestings', 'the creation');
  await page.waitForTimeout(1500);
  await shot('14-created', 'Review and sign');
}

// --- 3. From a CSV (pictures 15 and 16) -------------------------------------------

if (phase(15, 16)) {
  await go('/create');
  await until(hasText, 'The token to lock', 'the token list', 120000);
  await page.locator('select').first().selectOption(TOKEN);
  await button('From a CSV').click();
  // 60 lines: two transactions, one wallet prompt. Half of them for this
  // wallet, so My vestings has something to claim.
  const lines = ['address,amount'];
  for (let i = 0; i < 60; i++)
    lines.push(`${i % 2 ? TEAMMATE : YOU},${100 + i}`);
  await page.getByPlaceholder(/^address,amount/).fill(lines.join('\n'));
  // Linear over a year that began six months ago: half has vested already.
  await field('Start').fill(localDate(-182));
  await field('How the rest is released').selectOption('linear');
  await field('End').fill(localDate(183));
  await page.getByRole('button', { name: /^Cannot be cancelled/ }).click();
  await field('Label (optional)').fill('Community 2026');
  await page.waitForTimeout(1500);
  await shot('15-csv', 'Beneficiaries');

  await button('Check and sign').click();
  await until(
    hasText,
    'transactions would go through',
    'the network check',
    300000
  );
  await page.waitForTimeout(800);
  await shot('16-csv-checked', 'Review and sign');
  await say(
    'Press "Sign in your wallet" and approve in xPortal (60 vestings, two transactions, one approval).'
  );
  await until(matches, 'Created 60 vestings', 'the creation');
  await page.waitForTimeout(1500);
}

// --- 4. My vestings and Claim all (pictures 17 and 18) ------------------------------

if (phase(17, 18)) {
  await go('/mine');
  await until(matches, 'Claim all \\(\\d+\\)', 'Claim all', 180000);
  await page.waitForTimeout(1500);
  await shot('17-mine');
  await button(
    (await page.getByRole('button', { name: /^Claim all/ }).innerText()).trim()
  ).click();
  await until(hasText, 'would go through', 'the network check', 300000);
  await say('Press "Sign in your wallet" and approve in xPortal (Claim all).');
  await until(hasText, 'done', 'the claim');
  await page.waitForTimeout(4000);
  await shot('18-claimed');
}

// --- 5. Created by me and a cancel (pictures 19 to 21) ------------------------------

if (phase(19, 21)) {
  await go('/created');
  await until(buttonEnabled, 'Export to CSV', 'the created list', 180000);
  await page.waitForTimeout(1500);
  await shot('19-created');
  // The advisor's vesting of "Team 2027": its card is the one with 3,000.
  const card = page
    .locator('div', { hasText: 'Team 2027' })
    .filter({ hasText: '3,000' })
    .last();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await until(hasText, 'would go through', 'the network check', 180000);
  await page.waitForTimeout(800);
  await shot('20-cancel');
  const id = await page.evaluate(
    () => (document.body.innerText.match(/Cancel vesting #(\d+)/) || [])[1]
  );
  await say('Press "Sign in your wallet" and approve in xPortal (the cancel).');
  await until(hasText, 'done', 'the cancel');
  await page.waitForTimeout(4000);
  if (id) {
    await go(`/v/${id}`);
    await until(hasText, 'Cancelled on', 'the cancelled vesting', 120000);
    await page.waitForTimeout(1500);
    await shot('21-cancelled');
  }
}

// --- 6. Without a wallet (pictures 1 to 4) -------------------------------------------

if (phase(1, 4)) {
  if (await page.evaluate(connected)) {
    await say(
      'Disconnecting: these pictures are taken without a wallet.',
      'ok'
    );
    await page.locator('[aria-label="Disconnect"]').click();
    await until(
      () => !document.querySelector('[aria-label="Disconnect"]'),
      null,
      'the disconnect',
      60000
    );
  }
  await say('Nothing to do: photographing the site without a wallet.', 'ok');
  await go('/');
  await page.waitForTimeout(1200);
  await shot('01-home');

  // The "Team 2027" vesting of this wallet, found from its address page.
  await go(`/a/${YOU}`);
  await until(hasText, 'Claim keys it holds', 'the address page', 120000);
  await page.waitForTimeout(2000);
  await shot('04-address');
  const vestingId = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href^="/v/"]')].find((a) =>
      a.parentElement?.innerText.includes('Team 2027')
    );
    return link ? link.getAttribute('href') : null;
  });
  if (vestingId) {
    await go(vestingId);
    await until(hasText, 'Keys and people', 'the vesting', 120000);
    await page.waitForTimeout(2000);
    await shot('02-vesting');
  }
  await go(`/t/${TOKEN}`);
  await until(hasText, 'Unlock calendar', 'the token page', 120000);
  await page.waitForTimeout(2000);
  await shot('03-token');
}

// --- 7. A token whose issuer keeps powers (picture 22): mainnet, read only ----------

if (phase(22, 22)) {
  await go('/t/FOXSY-5d5f3e', MAINNET);
  await until(hasText, 'The issuer of FOXSY', 'the issuer notice', 120000);
  await page.waitForTimeout(1500);
  await shot('22-issuer', 'The issuer of FOXSY');
}

await say('All pictures taken. You can close the window.', 'ok');
console.log('\nDone. Turn them into JPEGs with ./scripts/capture/to-web.sh');
if (process.env.HEADLESS !== '1') {
  await until(() => false, null, 'the window to close', 600000);
}
await ctx.close().catch(() => {});
