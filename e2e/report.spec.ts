import { expect, test, type Page } from '@playwright/test';

test('設定はフォーカスを管理し、旧感情モデル設定を表示しない', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: '設定', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: '設定とデータ' });
  await expect(dialog.getByRole('button', { name: '閉じる' })).toBeFocused();
  await expect(dialog).toContainText('gpt-6-astra');
  await expect(dialog).not.toContainText('ローカル感情モデル');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test('保存済み分析を開いて個別削除できる', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const id = await createFixtureRun(page);
  await page.goto(`/?run=${id}`);
  await expect(page.getByRole('heading', { name: 'このコメント欄で語られていること' })).toBeVisible();
  await page.getByRole('button', { name: '新しい動画を分析' }).click();
  const count = await page.locator('.recent-row').count();
  const firstDelete = page.getByRole('button', { name: /を削除$/ }).first();
  await firstDelete.click();
  const dialog = page.getByRole('alertdialog', { name: 'この分析結果を削除しますか？' });
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(firstDelete).toBeFocused();
  await firstDelete.click();
  await dialog.getByRole('button', { name: '削除', exact: true }).click();
  await expect(page.locator('.recent-row')).toHaveCount(count - 1);
});

async function createFixtureRun(page: Page) {
  const response = await page.request.post('/api/runs', { data: { url: 'https://www.youtube.com/watch?v=vlpLbiqNhLo', max_comments: 3, force_refresh: true } });
  expect(response.ok()).toBeTruthy();
  const { run_id: runId } = await response.json() as { run_id: string };
  await expect.poll(async () => (await (await page.request.get(`/api/runs/${runId}/report`)).json()).status).toBe('completed');
  return runId;
}
