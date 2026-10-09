import { test, expect, devices, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TOUCH_HOLD_MS } from "../lib/touchIntent";

async function project(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Project", exact: false }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  return JSON.parse(await readFile((await file.path())!, "utf8")).document;
}
async function openMotion(page: Page, mobile: boolean) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make an icon move", exact: true }).click();
  await page.getByRole("button", { name: "Close animation exercise" }).click();
  await page.getByRole("button", { name: "Animate Rotation", exact: true }).click();
  if (mobile) {
    const motion = page
      .getByRole("navigation", { name: "Panels" })
      .getByRole("button", { name: "Motion", exact: true });
    if ((await motion.getAttribute("aria-pressed")) !== "true") await motion.click();
  }
  await page
    .getByRole("button", { name: "Select Rotation track for Moving icon", exact: true })
    .click();
  const time = page.getByRole("textbox", { name: "Current time in milliseconds" });
  await time.fill("400");
  await time.press("Enter");
  await page
    .getByRole("button", { name: "Add Rotation for Moving icon keyframe", exact: true })
    .click();
  const closeKeyEditor = page.getByRole("button", { name: "Close keyframe editor", exact: true });
  if (await closeKeyEditor.isVisible()) await closeKeyEditor.click();
  await time.fill("250");
  await time.press("Enter");
}
const ruler = (page: Page) => page.getByRole("slider", { name: "Timeline playhead" });

for (const mobile of [true, false]) {
  const layout = mobile ? "mobile" : "desktop";
  test(`${layout} timeline pinches at the touched time and hands off to one-finger scrolling`, async ({
    browser,
  }, info) => {
    test.skip(info.project.name !== "desktop", "Native Chromium multi-touch injection.");
    const context = await browser.newContext(
      mobile
        ? { ...devices["Pixel 7"] }
        : { viewport: { width: 1440, height: 1000 }, hasTouch: true },
    );
    try {
      const page = await context.newPage();
      await openMotion(page, mobile);
      const before = await project(page);
      const cdp = await context.newCDPSession(page);
      const touch = (
        type: "touchStart" | "touchMove" | "touchEnd",
        points: { id: number; x: number; y: number }[],
      ) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map((p) => ({ ...p, radiusX: 5, radiusY: 5, force: 1 })),
        });
      const box = (await ruler(page).boundingBox())!;
      const width = () => ruler(page).evaluate((el) => el.getBoundingClientRect().width);
      const viewport = page.getByLabel("Animation tracks", { exact: true });
      const scroll = () => viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
      const body = (await viewport.boundingBox())!;
      const a = { id: 1, x: box.x + box.width * 0.35, y: body.y + body.height - 8 };
      const b = { id: 2, x: box.x + box.width * 0.65, y: a.y };
      const anchorX = (a.x + b.x) / 2;
      await touch("touchStart", [a]);
      await touch("touchStart", [a, b]);
      expect(await width()).toBeCloseTo(box.width, 3);
      a.x -= box.width * 0.075;
      b.x += box.width * 0.075;
      await touch("touchMove", [a, b]);
      await expect.poll(width).toBeCloseTo(box.width * 1.5, 2);
      const zoomed = (await ruler(page).boundingBox())!;
      expect((anchorX - zoomed.x) / zoomed.width).toBeCloseTo(0.5, 3);
      const pinched = await scroll();
      await touch("touchEnd", [a]);
      b.x -= 22;
      await touch("touchMove", [b]);
      await expect.poll(async () => (await scroll()).x).toBeCloseTo(pinched.x + 22, 0);
      expect(await width()).toBeCloseTo(zoomed.width, 2);
      await touch("touchEnd", []);
      // A new single-finger drag on blank tracks also pans the time axis.
      a.x = anchorX;
      a.y = body.y + body.height - 8;
      const start = await scroll();
      await touch("touchStart", [a]);
      a.x -= 12;
      await touch("touchMove", [a]);
      await touch("touchEnd", []);
      await expect.poll(async () => (await scroll()).x).toBeCloseTo(start.x + 12, 0);
      if (mobile) {
        const handle = page.getByRole("slider", { name: "Panel height" });
        const grab = (await handle.boundingBox())!;
        const contact = { id: 3, x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 };
        await touch("touchStart", [contact]);
        contact.y -= 40;
        await touch("touchMove", [contact]);
        await touch("touchEnd", []);
        await expect.poll(async () => (await handle.boundingBox())!.y).toBeCloseTo(grab.y - 40, 0);
        expect(await width()).toBeCloseTo(zoomed.width, 2);
      }
      expect(await project(page)).toEqual(before);
      expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
      await page.screenshot({ path: `/tmp/pathshift-timeline-pinch-${layout}.png` });
      if (mobile) {
        const savedScroll = await scroll();
        await page.getByRole("button", { name: "Close panel" }).tap();
        await expect(viewport).toHaveCount(0);
        await page.getByRole("button", { name: "Motion", exact: true }).tap();
        await expect.poll(width).toBeCloseTo(zoomed.width, 2);
        await expect.poll(async () => (await scroll()).x).toBeCloseTo(savedScroll.x, 0);
      }
    } finally {
      await context.close();
    }
  });

  for (const kind of ["keyframe", "duration", "scrub"] as const) {
    test(`${layout} pinch cancels an active timeline ${kind} edit without resuming it`, async ({
      browser,
    }, info) => {
      test.skip(info.project.name !== "desktop", "Native Chromium multi-touch injection.");
      const context = await browser.newContext(
        mobile
          ? { ...devices["Pixel 7"] }
          : { viewport: { width: 1440, height: 1000 }, hasTouch: true },
      );
      try {
        const page = await context.newPage();
        await openMotion(page, mobile);
        const before = await project(page);
        const cdp = await context.newCDPSession(page);
        const touch = (
          type: "touchStart" | "touchMove" | "touchEnd",
          points: { id: number; x: number; y: number }[],
        ) =>
          cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: points.map((p) => ({ ...p, radiusX: 5, radiusY: 5, force: 1 })),
          });
        const target =
          kind === "keyframe"
            ? page.getByRole("button", {
                name: "Rotation end keyframe at 400 milliseconds",
                exact: true,
              })
            : kind === "duration"
              ? page.getByRole("slider", { name: "Animation duration", exact: true })
              : ruler(page);
        const box = (await target.boundingBox())!;
        const rulerBefore = (await ruler(page).boundingBox())!;
        const width = () => ruler(page).evaluate((el) => el.getBoundingClientRect().width);
        const a = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await touch("touchStart", [a]);
        // Keyframes pick up only after a still hold; a quick swipe scrolls.
        if (kind === "keyframe") await page.waitForTimeout(TOUCH_HOLD_MS + 100);
        a.x -= 20;
        await touch("touchMove", [a]);
        if (kind === "duration")
          await expect(
            page.getByRole("slider", { name: "Animation duration", exact: true }),
          ).not.toHaveAttribute("aria-valuenow", "1000");
        if (kind === "keyframe")
          await expect(
            page.getByRole("button", {
              name: "Rotation end keyframe at 400 milliseconds",
              exact: true,
            }),
          ).toHaveCount(0);
        if (kind === "scrub")
          await expect(
            page.getByRole("textbox", { name: "Current time in milliseconds" }),
          ).not.toHaveValue("250");
        const b = { id: 2, x: a.x - 80, y: a.y };
        await touch("touchStart", [a, b]);
        await expect(
          page.getByRole("textbox", { name: "Current time in milliseconds" }),
        ).toHaveValue("250");
        b.x -= 35;
        await touch("touchMove", [a, b]);
        await expect.poll(width).toBeGreaterThan(rulerBefore.width * 1.3);
        await touch("touchEnd", [a]);
        b.x += 15;
        await touch("touchMove", [b]);
        await touch("touchEnd", []);
        await expect(
          page.getByRole("textbox", { name: "Current time in milliseconds" }),
        ).toHaveValue("250");
        expect(await project(page)).toEqual(before);
      } finally {
        await context.close();
      }
    });
  }
}
