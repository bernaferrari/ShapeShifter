import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function exportedDocument(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Project", exact: false }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  await expect(dialog).not.toBeVisible();
  return JSON.parse(await readFile((await file.path())!, "utf8")).document;
}

test.beforeEach(async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dismiss onboarding", exact: true }).click();
  if (info.project.name === "phone")
    await page.getByRole("button", { name: "Design", exact: true }).click();
  else await page.getByRole("button", { name: "Upper", exact: true }).first().click();
  await page.getByRole("button", { name: "Focus path points" }).click();
  await page
    .getByRole("button", { name: /^Make edge .* curved$/ })
    .first()
    .click();
});

test("hover connects points, curve controls and edges in both directions without authoring", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Hover is a mouse interaction.");
  const original = await exportedDocument(page);
  const canvas = page.locator("#editor-canvas");
  const label = canvas.locator("[data-path-point-label]");
  const point1 = page.getByRole("button", { name: "Select point 1", exact: true });
  await point1.hover();
  await expect(label).toHaveText("Point 1");
  await expect(canvas.locator('[data-path-address="0:0:0"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(point1).toHaveAttribute("aria-pressed", "false");
  await point1.click();
  await page.getByRole("button", { name: "Select point 1 outgoing", exact: true }).hover();
  await expect(label).toHaveText("Point 1 · outgoing");
  await expect(canvas.locator('[data-path-address="0:1:0"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );

  await canvas.locator('[data-path-address="0:1:1"]').hover();
  await expect(label).toHaveText("Point 2 · incoming");
  const incoming = page.getByRole("button", { name: "Select point 2 incoming", exact: true });
  await expect(incoming).toBeVisible();
  await expect(incoming.locator("..")).toHaveAttribute("data-hovered", "true");
  await expect(page.locator('[data-path-point="0:2"]')).toHaveAttribute("data-hovered", "true");
  await expect(page.getByRole("button", { name: "Select point 2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // A vertical SVG path has a zero-width box despite its touchable stroke.
  const edgeMidpoint = await canvas.locator('[data-path-edge="0:1"]').evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = point.matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(edgeMidpoint.x, edgeMidpoint.y);
  await expect(label).toHaveText("Points 1 → 2");
  await expect(canvas.locator('[data-path-address="0:0:0"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(canvas.locator('[data-path-address="0:1:2"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(canvas.locator('[data-path-edge="0:1"]')).toHaveAttribute("stroke-width", "12");
  await page.mouse.move(edgeMidpoint.x + 4, edgeMidpoint.y);
  await expect(label).toHaveText("Points 1 → 2");
  await page.mouse.move(5, 5);
  await expect(page.locator('[data-path-point="0:2"]')).not.toHaveAttribute("data-hovered", "true");
  expect(await exportedDocument(page)).toEqual(original);
});

test("point selection reveals curve controls on touch and keyboard", async ({ page }, info) => {
  const point1 = page.getByRole("button", { name: "Select point 1", exact: true });
  const point2 = page.getByRole("button", { name: "Select point 2", exact: true });
  if (info.project.name === "phone") await point1.tap();
  else {
    await point1.focus();
    await expect(page.locator("[data-path-point-label]")).toHaveText("Point 1");
    await expect(point1).toHaveAttribute("aria-pressed", "false");
    await point1.press("Enter");
  }
  await expect(point1).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Point 1 outgoing X", exact: true }),
  ).toBeVisible();
  if (info.project.name === "phone") await point2.tap();
  else await point2.press("Enter");
  await expect(point2).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "Point 2 incoming X", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Point 1 outgoing X", exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: `/tmp/shapeshifter-point-ui-${info.project.name}.png` });
});
