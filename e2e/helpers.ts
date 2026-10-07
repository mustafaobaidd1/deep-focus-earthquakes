import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const LIVE_FEED = '**/earthquake.usgs.gov/**';
export const liveFixture = readFileSync(
  new URL('./fixtures/live-feed.csv', import.meta.url),
  'utf8',
);

/** Blocks the network to USGS unless a test sets up its own route (tests never hit the live API). */
export async function blockLiveFeed(page: Page) {
  await page.route(LIVE_FEED, (route) => route.abort('internetdisconnected'));
}

export async function openApp(page: Page, path = './') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
}

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 700;
}

/** The filter controls live in the stage on wide screens and in a tab on phones. */
export async function showFilters(page: Page) {
  if (isPhone(page)) await page.getByRole('tab', { name: 'Filters' }).click();
}

export async function showSection(page: Page) {
  await page.getByRole('tab', { name: isPhone(page) ? 'Section' : 'Cross-section' }).click();
}

export async function showStats(page: Page) {
  await page.getByRole('tab', { name: 'Statistics' }).click();
}

/** Secondary map options sit behind a "More" button on phones. */
export async function openMapOptions(page: Page) {
  if (!isPhone(page)) return;
  const more = page.getByRole('button', { name: 'More map options' });
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}

/** Reads the "N of M earthquakes" / "N earthquakes, all shown" count as a number. */
export async function shownCount(page: Page): Promise<number> {
  const text = await page.locator('.filters .count strong').first().innerText();
  return Number(text.replace(/[^0-9]/g, ''));
}
