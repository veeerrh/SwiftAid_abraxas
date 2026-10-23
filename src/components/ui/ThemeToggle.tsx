"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("swiftaid-theme", next);
    } catch {
      /* private mode */
    }
    setTheme(next);
    window.dispatchEvent(new Event("swiftaid-theme"));
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label="Toggle theme"
      className="grid size-9 place-items-center rounded-lg bg-surface2 text-dim transition hover:bg-surface3 hover:text-ink"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
