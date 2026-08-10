import { expect, test, type Page } from "@playwright/test";

test("設定Dialogはフォーカスを管理しEscで閉じる", async ({ page }) => {
  await page.goto("/");
  const settingsButton = page.getByRole("button", { name: "設定" });
  await settingsButton.click();

  const dialog = page.getByRole("dialog", { name: "設定とデータ" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
});

test("最近の分析を個別削除・一括削除できる", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "履歴削除の統合確認はdesktopで代表実行する");
  await page.request.post("/api/data/actions", { data: { action: "delete_all_runs" } });
  await createFixtureRun(page);
  await createFixtureRun(page);
  await page.goto("/");

  await expect(page.locator(".recent-actions")).toContainText("2件");
  const firstDelete = page.getByRole("button", { name: /を削除$/ }).first();
  await firstDelete.click();
  const individualDialog = page.getByRole("alertdialog", { name: "この分析結果を削除しますか？" });
  await expect(individualDialog).toContainText("YouTubeコメントのキャッシュは削除しません");
  await individualDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(firstDelete).toBeFocused();

  await firstDelete.click();
  await individualDialog.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.locator(".recent-actions")).toContainText("1件");

  await page.getByRole("button", { name: "すべて削除" }).click();
  const allDialog = page.getByRole("alertdialog", { name: "1件の分析結果をすべて削除しますか？" });
  await expect(allDialog).toContainText("この操作は元に戻せません");
  await allDialog.getByRole("button", { name: "すべて削除" }).click();
  await expect(page.getByText("まだ分析結果はありません。")).toBeVisible();
});

test("人物候補の修正は再集計済みレポートを同じレスポンスで返す", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "候補修正APIの統合確認はdesktopで代表実行する");
  await page.request.post("/api/data/actions", { data: { action: "delete_all_runs" } });
  const runId = await createFixtureRun(page);
  const candidatesResponse = await page.request.get(`/api/runs/${runId}/candidates`);
  const candidates = await candidatesResponse.json() as { persons: Array<{ person_id: string }> };
  const personId = candidates.persons[0]?.person_id;
  expect(personId).toBeTruthy();

  const response = await page.request.post(`/api/runs/${runId}/candidate-actions`, {
    data: { actions: [{ type: "accept_person", person_id: personId }] }
  });
  expect(response.ok()).toBe(true);
  const result = await response.json() as {
    candidates: { run_id: string; persons: Array<{ person_id: string; status: string }> };
    report: { schema_version: string; run_id: string };
  };
  expect(result.candidates.run_id).toBe(runId);
  expect(result.candidates.persons.find((person) => person.person_id === personId)?.status).toBe("accepted");
  expect(result.report).toMatchObject({ schema_version: "report.v2", run_id: runId });
});

test("暫定レポートから人物・コメントの根拠へ移動できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "YouTubeコメントを分析" })).toBeVisible();

  await page.getByText("詳細設定").click();
  await expect(page.getByRole("radio", { name: /返信を追加取得/ })).toBeChecked();

  await page.getByLabel("YouTube動画のURL").fill("https://www.youtube.com/watch?v=vlpLbiqNhLo");
  await page.getByRole("button", { name: "分析する" }).click();

  await expect(page.getByText("暫定レポート", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "この動画はどう受け取られた？" })).toBeVisible();
  const reception = page.getByRole("region", { name: "この動画はどう受け取られた？" });
  await expect(reception.getByRole("group", { name: /ポジティブ/ })).toBeVisible();
  await reception.getByRole("button", { name: "ポジティブのコメントを表示" }).first().click();
  await expect(page.getByRole("tab", { name: "コメント", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("感情")).toHaveText(/ポジティブ/);
  await expect(page.locator(".comment-row").first().getByText("ポジティブ", { exact: true })).toBeVisible();
  await expect(page.getByLabel("並び順")).toHaveText(/高評価順/);

  await expect.poll(async () => {
    const likeCounts = await page.locator(".comment-like").evaluateAll((items) => items.map((item) => Number(item.textContent?.replace(/\D/g, "") || 0)));
    return likeCounts.every((value, index) => index === 0 || likeCounts[index - 1] >= value);
  }).toBe(true);

  await page.getByRole("tab", { name: "概要", exact: true }).click();

  const overviewTab = page.getByRole("tab", { name: "概要", exact: true });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "人物", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "人物別の受け取られ方" })).toBeVisible();

  await page.getByRole("tab", { name: "コメント", exact: true }).click();
  await expect(page.getByRole("heading", { name: "根拠コメント" })).toBeVisible();
  await page.getByLabel("感情").click();
  await page.getByRole("option", { name: "すべて" }).click();
  await page.getByRole("searchbox", { name: "検索" }).fill("みりちゃむ");
  await expect(page.getByRole("article").filter({ hasText: "みりちゃむ" }).first()).toBeVisible();

  const viewportHealth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    navHeights: Array.from(document.querySelectorAll<HTMLElement>(".report-nav__item")).map((item) => item.getBoundingClientRect().height)
  }));
  expect(viewportHealth.scrollWidth).toBeLessThanOrEqual(viewportHealth.clientWidth);
  expect(Math.min(...viewportHealth.navHeights)).toBeGreaterThanOrEqual(44);

  await page.getByRole("tab", { name: "概要", exact: true }).click();
  const reviewButton = page.getByRole("button", { name: "レビューを開く" });
  await reviewButton.click();
  const reviewDialog = page.getByRole("dialog", { name: "レビューセンター" });
  await expect(reviewDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reviewDialog).toBeHidden();
  await expect(reviewButton).toBeFocused();

  const theme = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains("dark"),
    background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
  }));
  expect(theme.background).not.toBe("");
  expect(theme.dark).toBe(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches));
});

async function createFixtureRun(page: Page): Promise<string> {
  const createdResponse = await page.request.post("/api/runs", {
    data: {
      url: "https://www.youtube.com/watch?v=vlpLbiqNhLo",
      max_comments: 10,
      reply_fetch_mode: "none",
      fetch_order: "relevance",
      force_refresh: false
    }
  });
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json() as { job_id: string };
  let runId = "";
  await expect.poll(async () => {
    const response = await page.request.get(`/api/jobs/${created.job_id}`);
    const job = await response.json() as { status: string; run_id?: string };
    runId = job.run_id ?? runId;
    return job.status;
  }, { timeout: 30_000 }).toBe("completed");
  expect(runId).not.toBe("");
  return runId;
}

test("三段階再判定と人の修正がコメント詳細へ反映される", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "状態更新の統合確認はdesktopで代表実行する");
  await page.goto("/");
  await page.getByLabel("YouTube動画のURL").fill("https://www.youtube.com/watch?v=vlpLbiqNhLo");
  await page.getByRole("button", { name: "分析する" }).click();
  await expect(page.getByText("暫定レポート", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "レビューを開く" }).click();
  const review = page.getByRole("dialog", { name: "レビューセンター" });
  await review.getByRole("button", { name: "感情を再判定" }).click();
  await expect(review.getByText("利用済み", { exact: true }).last()).toBeVisible({ timeout: 30_000 });

  const reviewItem = review.locator(".review-item").filter({ hasText: "動画全体" }).first();
  const sentimentChoice = reviewItem.getByLabel("感情を修正");
  const commentText = (await reviewItem.locator("p").first().textContent())?.trim() ?? "";
  expect(commentText.length).toBeGreaterThan(3);
  await sentimentChoice.getByRole("button", { name: "ポジティブ" }).click();
  await review.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("tab", { name: "コメント", exact: true }).click();
  await page.getByRole("searchbox", { name: "検索" }).fill(commentText.slice(0, 12));
  const matched = page.locator(".comment-row").filter({ hasText: commentText.slice(0, 12) }).first();
  await expect(matched.locator(".human-badge")).toHaveText("人が修正");
  await matched.getByText("判定詳細", { exact: true }).click();
  await expect(matched.getByText("人が修正", { exact: true })).toHaveCount(2);
  await expect(matched.locator(".sentiment-details")).toContainText("fake/sentiment");
});
