"use client";

import React from "react";
import { initializeTheme, type Theme } from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
});

function getSystemTheme() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Vector and motion tools benefit from stable dark chrome around a bright canvas.
  // Existing user preference still wins when one has already been stored.
  const [theme, setThemeState] = React.useState<Theme>("dark");
  const [systemTheme, setSystemTheme] = React.useState<"light" | "dark">("dark");
  const [ready, setReady] = React.useState(false);

  React.useLayoutEffect(() => {
    setThemeState(initializeTheme().theme);
    setSystemTheme(getSystemTheme());
    setReady(true);
  }, []);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  React.useLayoutEffect(() => {
    if (ready) applyTheme(resolvedTheme);
  }, [ready, resolvedTheme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    try {
      window.localStorage.setItem("theme", nextTheme);
    } catch {
      // Theme switching remains available without persistent browser storage.
    }
    setThemeState(nextTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  return React.useContext(ThemeContext);
}

export { ThemeProvider, useTheme };
