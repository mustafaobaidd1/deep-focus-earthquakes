import { expect, test } from '@playwright/test';
import {
  LIVE_FEED,
  blockLiveFeed,
  isPhone,
  liveFixture,
  openApp,
  openMapOptions,
  showFilters,
  showSection,
  showStats,
  shownCount,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await blockLiveFeed(page);
});

test('opens on the featured Tonga section with a fitted slab dip', async ({ page }) => {
  await openApp(page);
  await showSection(page);
  await expect(page.getByRole('heading', { name: 'Tonga–Kermadec subduction zone' })).toBeVisible();
  await expect(page.locator('.chart svg circle').first()).toBeAttached();
  expect(await page.locator('.chart svg circle').count()).toBeGreaterThan(500);
  await expect(page.locator('.fit .headline')).toHaveText(/^\s*4\d\.\d°/);
  await expect(page.locator('.fig-label').first()).toBeVisible();
});

test('filters change the visible count', async ({ page }) => {
  await openApp(page);
  await showFilters(page);
  const before = await shownCount(page);
  expect(before).toBeGreaterThan(80_000);

  const minMag = page.getByRole('slider', { name: 'Magnitude: lower limit' });
  await minMag.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // 5.0 → 7.0
  await expect.poll(() => shownCount(page)).toBeLessThan(1_000);
  const atM7 = await shownCount(page);
  expect(atM7).toBeGreaterThan(500);

  await page.getByRole('button', { name: 'Deep: 300 km and below' }).click();
  await expect.poll(() => shownCount(page)).toBeLessThan(atM7);

  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect.poll(() => shownCount(page)).toBe(before);
});

test('an impossible filter shows the empty state', async ({ page }) => {
  await openApp(page);
  await showFilters(page);
  const minMag = page.getByRole('slider', { name: 'Magnitude: lower limit' });
  await minMag.focus();
  await page.keyboard.press('End'); // 9.2: nothing that large
  await expect.poll(() => shownCount(page)).toBe(0);
  await showStats(page);
  await expect(
    page.locator('#panel-stats').getByText('No earthquakes match these filters'),
  ).toBeVisible();
});

test('choosing a preset recomputes the section; a strike-slip boundary has no slab', async ({
  page,
}) => {
  await openApp(page);
  await showSection(page);
  await page.getByRole('button', { name: 'Hindu Kush' }).click();
  await expect(
    page.getByRole('heading', { name: 'Hindu Kush intermediate-depth zone' }),
  ).toBeVisible();
  await expect(page.locator('.fit .headline')).toHaveText(/^\s*[78]\d\.\d°/);

  await page.getByRole('button', { name: 'Dead Sea Transform' }).click();
  await expect(page.getByRole('heading', { name: 'Dead Sea Transform (contrast)' })).toBeVisible();
  await expect(page.locator('.fit .headline')).toHaveText('No slab to fit');
});

test('drawing a line on the globe cuts a new section', async ({ page }) => {
  await openApp(page);
  await page
    .getByRole('button', { name: isPhone(page) ? 'Draw a cross-section' : 'Draw section' })
    .click();
  const canvas = page.locator('.globe-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const span = Math.min(box.width, box.height) * 0.25;
  await page.mouse.move(cx - span, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx - span + (2 * span * k) / 10, cy + 4 * k);
  await page.mouse.up();
  await showSection(page);
  await expect(page.getByRole('heading', { name: 'Your section' })).toBeVisible();
  await expect(page.locator('#panel-section figcaption')).toContainText(
    /\d[\d,]* earthquakes? within \d+ km of the line/,
  );
  await expect(page.getByRole('slider', { name: /Earthquakes in the section/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tonga' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('the endpoint editor cuts a section from typed coordinates', async ({ page }) => {
  await openApp(page);
  await showSection(page);
  await page.getByRole('button', { name: 'Edit endpoints' }).click();
  const lat = page.getByRole('spinbutton', { name: 'Latitude °' });
  const lon = page.getByRole('spinbutton', { name: 'Longitude °' });
  await lat.nth(0).fill('-28');
  await lon.nth(0).fill('-72');
  await lat.nth(1).fill('-28');
  await lon.nth(1).fill('-62');
  await page.getByRole('button', { name: 'Cut this section' }).click();
  await expect(page.getByRole('heading', { name: 'Your section' })).toBeVisible();
  await expect(page.locator('.fit .headline')).toHaveText(/°/);
});

test('the section chart can be explored with the keyboard', async ({ page }) => {
  await openApp(page);
  await showSection(page);
  const chart = page.getByRole('slider', { name: /Earthquakes in the section/ });
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(chart).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(chart).toHaveAttribute('aria-valuenow', '2');
  await expect(chart).toHaveAttribute('aria-valuetext', /^M \d\.\d, .* km from A/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Earthquake details' })).toBeVisible();
});

test('event details show depth, time and the USGS event page', async ({ page }) => {
  await openApp(page);
  await showStats(page);
  const first = page.locator('.largest li button').first();
  await expect(first).toContainText('M 9.1');
  await first.click();
  const card = page.getByRole('dialog', { name: 'Earthquake details' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('UTC');
  const link = card.getByRole('link', { name: /USGS event page/ });
  await expect(link).toHaveAttribute(
    'href',
    /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/.+/,
  );
  await card.getByRole('button', { name: 'Close details' }).click();
  await expect(card).toBeHidden();
});

test('plays through the years and updates the count', async ({ page }) => {
  await openApp(page);
  await showFilters(page);
  const all = await shownCount(page);
  await page.getByRole('button', { name: 'Play through the years' }).click();
  await expect(page.locator('.playhead')).toContainText(/Through 19\d\d/);
  await expect.poll(() => shownCount(page)).toBeLessThan(all);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByRole('button', { name: 'Stop playback and show all years' }).click();
  await expect.poll(() => shownCount(page)).toBe(all);
});

test('live layer: a failed request shows the fallback message and a retry', async ({ page }) => {
  await openApp(page);
  await openMapOptions(page);
  await page.getByRole('button', { name: /Live feed/ }).click();
  const status = page.locator('.live-status');
  await expect(status).toContainText('Live feed unavailable');
  await expect(status).toContainText('works offline');
  await expect(status.getByRole('button', { name: 'Retry' })).toBeVisible();
  // The bundled catalogue is untouched.
  await showFilters(page);
  expect(await shownCount(page)).toBeGreaterThan(80_000);
});

test('live layer: a successful request is parsed, counted and cached', async ({ page }) => {
  await page.unroute(LIVE_FEED);
  let requests = 0;
  await page.route(LIVE_FEED, (route) => {
    requests++;
    return route.fulfill({ status: 200, contentType: 'text/csv', body: liveFixture });
  });
  await openApp(page);
  await openMapOptions(page);
  await page.getByRole('button', { name: /Live feed/ }).click();
  await expect(page.locator('.live-status')).toContainText(
    'Live: 120 earthquakes in the past 30 days',
  );
  expect(requests).toBe(1);
  // A reload within 15 minutes is served from the cache without touching the network.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await openMapOptions(page);
  await page.getByRole('button', { name: /Live feed/ }).click();
  await expect(page.locator('.live-status')).toContainText('120 earthquakes');
  expect(requests).toBe(1);
});

test('without WebGL the flat map keeps filters and sections working', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (/webgl/i.test(type)) return null;
      return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...args);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openApp(page);
  await expect(page.getByRole('note')).toContainText('Flat-map edition');
  await expect(page.locator('canvas.map-canvas').first()).toBeVisible();
  await expect(page.locator('.globe-canvas')).toHaveCount(0);
  await showSection(page);
  await page.getByRole('button', { name: 'Chile' }).click();
  await expect(page.locator('.fit .headline')).toHaveText(/°/);
  await showFilters(page);
  const minMag = page.getByRole('slider', { name: 'Magnitude: lower limit' });
  await minMag.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => shownCount(page)).toBeLessThan(20_000);
});

test('true-depth mode and exaggeration are available on the globe', async ({ page }) => {
  await openApp(page);
  const depth = page.getByRole('radio', { name: isPhone(page) ? 'Depth' : 'True depth' });
  await depth.click();
  await expect(depth).toHaveAttribute('aria-checked', 'true');
  if (!isPhone(page)) {
    await page.getByRole('radio', { name: '×1' }).click();
    await expect(page.getByRole('radio', { name: '×1' })).toHaveAttribute('aria-checked', 'true');
  }
});

test('How it works explains the method with typeset equations', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'How it works' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'How it works' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'The b-value' })).toBeAttached();
  await expect(dialog.locator('.katex').first()).toBeAttached({ timeout: 10_000 });
  await expect(dialog).toContainText('Shi & Bolt');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
