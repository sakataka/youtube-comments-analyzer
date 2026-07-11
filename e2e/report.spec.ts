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
  await expect(page.getByRole("region", { name: "この動画はどう受け取られた？" }).getByRole("img", { name: /ポジティブ/ })).toBeVisible();

  const overviewTab = page.getByRole("tab", { name: "概要", exact: true });
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "人物", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "人物別の受け取られ方" })).toBeVisible();

  await page.getByRole("tab", { name: "コメント", exact: true }).click();
  await expect(page.getByRole("heading", { name: "根拠コメント" })).toBeVisible();
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
