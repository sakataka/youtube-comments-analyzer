import { expect, test } from '@playwright/test';

test('v3 要約から原文・返信文脈・修正へ進める', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('YouTube動画のURL').fill('https://www.youtube.com/watch?v=vlpLbiqNhLo');
  await page.getByRole('button', { name: '分析する', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'このコメント欄で語られていること' })).toBeVisible();
  await expect(page.getByText('取得範囲の分析完了', { exact: true })).toBeVisible();
  await expect(page.getByText('テスト用データです。実際の動画の反応ではありません。')).toBeVisible();
  await expect(page.locator('.opinion-summary-list li').first()).toContainText('件あります');
  const first = page.locator('.opinion-summary-list button').first();
  await first.click();
  const dialog = page.getByRole('dialog', { name: '根拠コメント' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.opinion-original').first()).not.toBeEmpty();
  await expect(dialog.getByRole('link', { name: 'YouTubeのコメントを開く' }).first()).toHaveAttribute('href', /&lc=/);
  await dialog.locator('.opinion-correction summary').first().click();
  await expect(dialog.getByLabel('対象', { exact: true }).first()).toHaveValue('動画');
  await dialog.getByLabel('原文を検索').fill('絶対に存在しない検索語');
  await expect(dialog.getByText('0件中 0〜0件')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: '目立つ反応と、全体の違い' })).toBeVisible();
  const health = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, title: document.title, overlay: document.querySelector('vite-error-overlay') !== null }));
  expect(health.scroll).toBeLessThanOrEqual(health.width);
  expect(health.title).not.toBe('');
  expect(health.overlay).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `/tmp/comments-v3-${testInfo.project.name}.png`, fullPage: true });
});

test('v3 小さい取得区切りから続行し、字幕を取り込める', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/');
  await page.getByText('詳細設定', { exact: true }).click();
  await page.getByLabel('1回に取得するコメント数').fill('3');
  // Force a new acquisition so a previous fixture run cannot satisfy the cache.
  await page.getByLabel('保存済みデータを使わず最新のコメントを取得する').check();
  await page.getByLabel('YouTube動画のURL').fill('https://www.youtube.com/watch?v=vlpLbiqNhLo');
  await page.getByRole('button', { name: '分析する', exact: true }).click();
  await expect(page.getByText('取得範囲の分析完了', { exact: true })).toBeVisible();
  await expect(page.locator('.opinion-metrics')).toContainText('3件取得');
  await page.getByRole('button', { name: '続きのコメントを取得・分析' }).click();
  await expect(page.locator('.opinion-metrics')).toContainText('6件取得');
  await expect(page.getByText('取得範囲の分析完了', { exact: true })).toBeVisible();
  await page.getByText('取得範囲・字幕・処理時間', { exact: true }).click();
  await page.getByLabel('字幕を取り込んで再分析').setInputFiles({ name: 'context.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n動画の背景です。\n') });
  await expect(page.getByText(/字幕：1区間/)).toBeVisible();
  await expect(page.getByText('取得範囲の分析完了', { exact: true })).toBeVisible();
});
