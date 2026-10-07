import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { blockLiveFeed } from './helpers';

test('has no serious or critical WCAG 2.2 AA violations', async ({ page }) => {
  await blockLiveFeed(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual([]);
});

test('the method drawer has no serious or critical violations either', async ({ page }) => {
  await blockLiveFeed(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByRole('button', { name: 'How it works' }).first().click();
  await expect(page.locator('.how .katex').first()).toBeAttached({ timeout: 10_000 });
  const results = await new AxeBuilder({ page })
    .include('.how')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual([]);
});
