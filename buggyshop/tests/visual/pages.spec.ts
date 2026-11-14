// What each main page looks like. These catch what the agent can't: it reads the accessibility
// tree, so a change that only shows on screen (colors, layout, overlap) is invisible to it.

import { test, expect, type Page } from "@playwright/test";

async function addToCart(page: Page, productId: string) {
  await page.goto(`/product/${productId}`);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: /^Cart \(/ })).not.toHaveText("Cart (0)");
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

test("home page", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await expect(page).toHaveScreenshot("home.png", { fullPage: true });
});

test("product page", async ({ page }) => {
  await page.goto("/product/mug");
  await settle(page);
  await expect(page).toHaveScreenshot("product.png", { fullPage: true });
});

test("cart with two items", async ({ page }) => {
  await addToCart(page, "mug");
  await addToCart(page, "lamp");
  await page.goto("/cart");
  await settle(page);
  await expect(page).toHaveScreenshot("cart.png", { fullPage: true });
});

test("checkout form", async ({ page }) => {
  await addToCart(page, "mug");
  await addToCart(page, "lamp");
  await page.goto("/checkout");
  await settle(page);
  await expect(page).toHaveScreenshot("checkout.png", { fullPage: true });
});

test("signup with a validation error", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Please enter a valid email address.")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("signup-error.png", { fullPage: true });
});
