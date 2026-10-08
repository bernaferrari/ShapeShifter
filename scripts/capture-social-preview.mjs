import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Capture the actual editor through its controls. Start the app before running this script.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 580 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await page.goto(process.env.PATHSHIFT_PREVIEW_URL || "http://localhost:3077");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  for (const layer of ["Upper", "Lower"]) {
    await page.getByRole("button", { name: layer, exact: true }).first().click();
    const fill = page.getByRole("textbox", { name: "Color hex value", exact: true }).first();
    await fill.fill("1496FF");
    await fill.press("Enter");
  }
  await page.getByRole("button", { name: "Upper", exact: true }).first().click();
  await page.getByRole("button", { name: "Zoom options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Fit frame", exact: false }).click();
  await page
    .getByRole("menuitem", { name: "Fit frame", exact: false })
    .waitFor({ state: "hidden" });
  await page.locator("#editor-canvas").focus();
  await page.keyboard.press("a");
  await expect(page.getByRole("button", { name: "Saved locally", exact: true })).toBeVisible();
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: fileURLToPath(new URL("../docs/pathshift-social-editor.jpg", import.meta.url)),
    type: "jpeg",
    quality: 96,
  });
} finally {
  await browser.close();
}
