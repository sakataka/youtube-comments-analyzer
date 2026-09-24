import { expect, test } from '@playwright/test';

test('v4 タブで結果を切り替え、根拠の原文をサイドパネルで読み、原文を検索できる', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  await page.goto('/');
  await page.getByLabel('YouTube動画のURL').fill('https://www.youtube.com/watch?v=vlpLbiqNhLo');
  await page.getByRole('button', { name: '分析する', exact: true }).click();
  await expect(page.getByText('抽出コメントの要約完了', { exact: true })).toBeVisible();
  await expect(page.getByText('テスト用データです。実際の動画の反応ではありません。')).toBeVisible();
  const tabs = page.getByRole('tablist', { name: '分析結果' });
  for (const [label, heading] of [['反応', '上に見えるコメントと全体のずれ'], ['人物', '誰について語られているか'], ['場面', 'コメントで時刻が挙がった場面'], ['原文', '取得したすべての原文'], ['概要', 'このコメント欄で語られていること']]) {
    await tabs.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(tabs.getByRole('tab', { name: 'X', exact: true })).toHaveCount(0);
  await tabs.getByRole('tab', { name: '反応' }).click();
  await expect(page).toHaveURL(/tab=reactions/);
  await expect(page.getByText('ローカル判定は無効です（LOCAL_MODELS=off）。')).toBeVisible();
  await expect(page.getByRole('button', { name: 'いいね上位', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tab-panel[data-state="active"] .comment-text').first()).not.toBeEmpty();
  await tabs.getByRole('tab', { name: '場面' }).click();
  await expect(page.getByText('時刻を含むコメントは見つかりませんでした。')).toBeVisible();

  await tabs.getByRole('tab', { name: '概要' }).click();
  const topicTitle = await page.locator('.card.topic h3').first().innerText();
  const evidence = page.getByRole('button', { name: '根拠の原文を読む' }).first();
  await evidence.click();
  const sheet = page.getByRole('dialog', { name: `根拠の原文：${topicTitle}` });
  await expect(sheet.locator('.comment-text').first()).not.toBeEmpty();
  await expect(sheet.getByRole('link', { name: 'YouTubeで開く ↗' }).first()).toHaveAttribute('href', /&lc=/);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(evidence).toBeFocused();

  await tabs.getByRole('tab', { name: /^原文/ }).click();
  const search = page.getByLabel('原文を検索', { exact: true });
  await search.fill('絶対に存在しない検索語');
  await expect(page.getByText('該当する原文はありません')).toBeVisible();
  await tabs.getByRole('tab', { name: '概要' }).click();
  await tabs.getByRole('tab', { name: /^原文/ }).click();
  await expect(search).toHaveValue('絶対に存在しない検索語');
  await search.fill('');
  await page.getByLabel('原文の並べ替え').selectOption('likes');
  await expect(page.locator('.tab-panel[data-state="active"] .comment-text').first()).not.toBeEmpty();
  const health = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, title: document.title, overlay: document.querySelector('vite-error-overlay') !== null }));
  expect(health.scroll).toBeLessThanOrEqual(health.width);
  expect(health.title).not.toBe(''); expect(health.overlay).toBe(false); expect(errors).toEqual([]);
  await tabs.getByRole('tab', { name: '概要' }).click();
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

test('人物別件数から原文・判定理由へ進み、別名をAIなしで修正できる', async ({page},testInfo) => {
  const result=await page.request.post('/api/runs',{data:{url:'https://www.youtube.com/watch?v=vlpLbiqNhLo',force_refresh:true}});
  const {run_id}=await result.json();
  await expect.poll(async () => (await (await page.request.get(`/api/runs/${run_id}/report`)).json()).person_statistics.status).toBe('completed');
  await page.goto(`/?run=${run_id}&tab=people`);
  const section=page.getByRole('region',{name:'誰について語られているか'});
  await section.getByRole('button',{name:'人物名・別名の辞書を編集'}).click();
  await page.getByLabel('1行に「人物名: 別名1, 別名2」').fill('風吹ケイ: 風吹, ケイ\n森脇梨々夏: 森脇, 梨々夏');
  const before=await (await page.request.get(`/api/runs/${run_id}/report`)).json();
  await page.getByRole('button',{name:'辞書を保存して再集計'}).click();
  await expect(section.getByRole('heading',{name:'風吹ケイ',exact:true})).toBeVisible();
  const after=await (await page.request.get(`/api/runs/${run_id}/report`)).json();
  expect(after.usage.calls).toBe(before.usage.calls);expect(after.topics).toEqual(before.topics);
  await section.locator('.person-card').filter({has:page.getByRole('heading',{name:'風吹ケイ',exact:true})}).getByRole('button',{name:/件 · 全件の/}).click();
  const sheet=page.getByRole('dialog',{name:'風吹ケイに言及した投稿'});
  await expect(sheet.locator('.comment-judgement').first()).toContainText('呼び名');
  await page.keyboard.press('Escape');
  await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/person-statistics-${testInfo.project.name}.png`,fullPage:false});
});
