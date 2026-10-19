import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
type Theme = "light" | "dark";
const ThemeContext = createContext<{
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
}>({ resolvedTheme: "light", setTheme: () => {} });
const readTheme = (): Theme => {
  try {
    return localStorage.getItem("lightsail-theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
};
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(readTheme);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("lightsail-theme", theme);
    } catch {
      /* The theme still works when browser storage is unavailable. */
    }
  }, [theme]);
  return (
    <ThemeContext.Provider value={{ resolvedTheme: theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
