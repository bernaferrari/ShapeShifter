export type Theme = "light" | "dark" | "system";

/** Self-contained so the identical initializer can run in the HTML head before React. */
export function initializeTheme() {
  let theme: Theme = "dark";
  try {
    const stored = window.localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") theme = stored;
  } catch {
    // Blocked storage must not prevent the editor's default theme from rendering.
  }
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
  return { theme, resolvedTheme };
}

// A blocking inline head script is intentional: the theme must precede first paint,
// even when application bundles are slow or fail to load.
export const THEME_BOOTSTRAP_SCRIPT = `(${initializeTheme.toString()})();`;
