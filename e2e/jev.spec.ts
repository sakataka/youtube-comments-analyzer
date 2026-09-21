import { expect, test } from '@playwright/test';

test('Jev分類を実行し種類で絞り込める・再実行はキャッシュを使う', async ({ page }) => {
  const response = await page.request.post('/api/runs', { data: { url: 'https://www.youtube.com/watch?v=vlpLbiqNhLo', force_refresh: true } });
  const { run_id } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).status).toBe('completed');
  await page.goto(`/?run=${run_id}`);
  const section = page.getByRole('region', { name: 'Jevコメント分類' });
  await section.getByRole('button', { name: 'Jevで分類する（最大500件）' }).click();
  await expect(section.getByRole('status').first()).toContainText('完了');
  await expect(section.locator('.opinion-original').first()).not.toBeEmpty();
  await section.getByLabel('Jevの種類').selectOption('request');
  await expect(section.getByText('0件中 0件を表示', { exact: true })).toBeVisible();
  await section.getByLabel('Jevの種類').selectOption('question');
  await expect(section.locator('.opinion-original').first()).not.toBeEmpty();
  await section.getByRole('button', { name: 'ややポジティブ', exact: false }).click();
  await expect(section.getByLabel('Jevの論調')).toHaveValue('positive');
  await section.getByLabel('分類したコメントを検索').fill('存在しない文字列123456789');
  await expect(section.getByText('0件中 0件を表示', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: '分類の絞り込みを解除' }).click();
  const before = (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).jev.usage.calls;
  await section.getByRole('button', { name: 'Jevで分類する（最大500件）' }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).jev.cache_hits).toBeGreaterThan(0);
  const after = (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).jev.usage.calls;
  expect(after).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});


test('Jevの件数は表示済み・追加表示・検索結果に一致する', async ({ page }) => {
  const response = await page.request.post('/api/runs', { data: { url: 'https://www.youtube.com/watch?v=vlpLbiqNhLo', force_refresh: true } });
  const { run_id } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).status).toBe('completed');
  const report = await (await page.request.get(`/api/runs/${run_id}/report`)).json();
  report.jev = { configured: true, status: 'completed', version: 'sentiment-v2', total: 45, rows: Array.from({ length: 45 }, (_, i) => ({ comment_id: `count-${i}`, text: `表示件数テスト ${i}`, kind: 'question', tone: 'neutral', tone_confidence: 1, url: 'https://www.youtube.com/watch?v=vlpLbiqNhLo' })) };
  await page.route(`**/api/runs/${run_id}/report`, route => route.fulfill({ json: report }));
  await page.goto(`/?run=${run_id}`);
  const section = page.getByRole('region', { name: 'Jevコメント分類' });
  for (const count of [20, 40, 45]) {
    await expect(section.getByText(`45件中 ${count}件を表示`, { exact: true })).toBeVisible();
    await expect(section.locator('.opinion-original')).toHaveCount(count);
    if (count < 45) await section.getByRole('button', { name: 'さらに20件表示' }).click();
  }
  await expect(section.getByRole('button', { name: 'さらに20件表示' })).toHaveCount(0);
  await section.getByLabel('分類したコメントを検索').fill('表示件数テスト 44');
  await expect(section.getByText('1件中 1件を表示', { exact: true })).toBeVisible();
  await expect(section.locator('.opinion-original')).toHaveCount(1);
});
