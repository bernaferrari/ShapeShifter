"use client";

import React from "react";

type Theme = "light" | "dark" | "system";

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

  React.useEffect(() => {
    const storedTheme = window.localStorage.getItem("theme") as Theme | null;
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      setThemeState(storedTheme);
    }
    setSystemTheme(getSystemTheme());
  }, []);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = React.useCallback((nextTheme: Theme) => {
    window.localStorage.setItem("theme", nextTheme);
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
