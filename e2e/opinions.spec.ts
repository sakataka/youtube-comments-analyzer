import { expect, test } from '@playwright/test';

test('v4 集計と抽出要約から原文を検索できる', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  await page.goto('/');
  await page.getByLabel('YouTube動画のURL').fill('https://www.youtube.com/watch?v=vlpLbiqNhLo');
  await page.getByRole('button', { name: '分析する', exact: true }).click();
  await expect(page.getByText('抽出コメントの要約完了', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '取得した全件の集計' })).toBeVisible();
  await expect(page.getByText('テスト用データです。実際の動画の反応ではありません。')).toBeVisible();
  await page.getByRole('button', { name: '根拠の原文を読む' }).first().click();
  await expect(page.locator('.opinion-original').first()).not.toBeEmpty();
  await expect(page.getByRole('link', {name:'YouTubeのコメントを開く ↗'}).first()).toHaveAttribute('href', /&lc=/);
  await page.getByLabel('原文を検索', {exact:true}).fill('絶対に存在しない検索語');
  await expect(page.getByText('0件中 0〜0件')).toBeVisible();
  await page.getByRole('button', { name: 'すべての原文を表示' }).click();
  await page.getByLabel('原文の並べ替え').selectOption('likes');
  await expect(page.locator('.opinion-original').first()).not.toBeEmpty();
  const health = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, title: document.title, overlay: document.querySelector('vite-error-overlay') !== null }));
  expect(health.scroll).toBeLessThanOrEqual(health.width);
  expect(health.title).not.toBe(''); expect(health.overlay).toBe(false); expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({ path: `/tmp/comments-v4-${testInfo.project.name}.png`, fullPage: true });
});

test('v4 小さい取得区切りから続行できる', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/'); await page.getByText('詳細設定', {exact:true}).click();
  await page.getByLabel('1回に取得するコメント数').fill('3');
  await page.getByLabel('保存済みデータを使わず最新のコメントを取得する').check();
  await page.getByLabel('YouTube動画のURL').fill('https://www.youtube.com/watch?v=vlpLbiqNhLo');
  await page.getByRole('button', {name:'分析する',exact:true}).click();
  await expect(page.getByText('抽出コメントの要約完了',{exact:true})).toBeVisible();
  await expect(page.getByLabel('取得と要約の状況')).toContainText('3件取得');
  await page.getByRole('button',{name:'続きのコメントを取得・要約'}).click();
  await expect(page.getByLabel('取得と要約の状況')).toContainText('6件取得');
  await expect(page.getByText('抽出コメントの要約完了',{exact:true})).toBeVisible();
});
