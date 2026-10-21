import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Capture the README screenshot and the share-card editor through the app's own controls.
// Run against a production build (`pnpm build && pnpm start --port 3077`) so no dev overlay shows.
const url = process.env.PATHSHIFT_PREVIEW_URL || "http://localhost:3077";
const output = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));

/** The starter play icon in brand blue, fit to its frame, with Upper selected. */
async function prepare(page) {
  await page.goto(url);
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
}

async function settle(page) {
  await expect(page.getByRole("button", { name: "Saved locally", exact: true })).toBeVisible();
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
  );
  await page.mouse.move(0, 0);
}

const browser = await chromium.launch();
try {
  const options = { deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" };

  // README: the whole workspace mid-morph, so the timeline and inspector tell the story.
  const readme = await browser.newPage({ ...options, viewport: { width: 1600, height: 1000 } });
  await prepare(readme);
  const time = readme.getByRole("textbox", { name: "Current time in milliseconds" });
  await time.fill("400");
  await time.press("Enter");
  await settle(readme);
  await readme.screenshot({ path: output("pathshift-editor.jpg"), type: "jpeg", quality: 92 });

  // Share card: a wide crop with the vector points of the play icon in edit mode.
  const social = await browser.newPage({ ...options, viewport: { width: 1400, height: 580 } });
  await prepare(social);
  await social.locator("#editor-canvas").focus();
  await social.keyboard.press("a");
  await settle(social);
  await social.screenshot({
    path: output("pathshift-social-editor.jpg"),
    type: "jpeg",
    quality: 96,
  });
} finally {
  await browser.close();
}
