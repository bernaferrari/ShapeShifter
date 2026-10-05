import { test, expect } from "@playwright/test";

for (const [preference, system, expected] of [
  [null, "light", "dark"],
  ["dark", "light", "dark"],
  ["light", "dark", "light"],
  ["system", "dark", "dark"],
  ["system", "light", "light"],
] as const) {
  test(`first paint uses ${expected} for preference ${preference} and system ${system}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript((value) => {
      if (value === null) localStorage.removeItem("theme");
      else localStorage.setItem("theme", value);
    }, preference);
    // The theme must work before the application's JavaScript can hydrate.
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await page.locator("html").evaluate((html) => html.classList.contains("dark"))).toBe(
      expected === "dark",
    );
    expect(await page.locator("html").evaluate((html) => html.style.colorScheme)).toBe(expected);
    // WebKit defers style resolution for a page whose application scripts were
    // blocked until it renders. Capture that render before sampling its colors.
    await page.screenshot();
    await expect
      .poll(() =>
        page.locator("body").evaluate((body, dark) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          context.fillStyle = getComputedStyle(body).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
          return (
            alpha === 255 && [r, g, b].every((channel) => (dark ? channel < 80 : channel > 240))
          );
        }, expected === "dark"),
      )
      .toBe(true);
  });
}

test("hydration keeps the saved light theme without switching through dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    const frames: boolean[] = [];
    (window as typeof window & { themeFrames: boolean[] }).themeFrames = frames;
    const frame = () => {
      if (document.body) frames.push(document.documentElement.classList.contains("dark"));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Make an icon move", exact: true })).toBeVisible();
  const frames = await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return (window as typeof window & { themeFrames: boolean[] }).themeFrames;
  });
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((dark) => !dark)).toBe(true);
});

test("system theme follows appearance changes after hydration", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "system"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Make an icon move", exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});
