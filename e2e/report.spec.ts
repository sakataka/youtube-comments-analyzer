import { expect, test } from "@playwright/test";

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
