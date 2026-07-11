import { expect, test } from "@playwright/test";

test("暫定レポートから人物・コメントの根拠へ移動できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "YouTubeコメントから、受け取られ方を読み解く。" })).toBeVisible();

  await page.getByLabel("YouTube動画のURL").fill("https://www.youtube.com/watch?v=vlpLbiqNhLo");
  await page.getByRole("button", { name: "分析する" }).click();

  await expect(page.getByText("暫定レポート", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "この動画はどう受け取られた？" })).toBeVisible();
  await expect(page.getByRole("region", { name: "この動画はどう受け取られた？" }).getByRole("img", { name: /ポジティブ/ })).toBeVisible();

  await page.getByRole("button", { name: "人物", exact: true }).click();
  await expect(page.getByRole("heading", { name: "人物別の受け取られ方" })).toBeVisible();

  await page.getByRole("button", { name: "コメント", exact: true }).click();
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
});
