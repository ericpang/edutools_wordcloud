// Day/night theme: follows the OS by default, manual override saved in localStorage.
// An inline script in each page's <head> applies the saved theme before first paint.

const STORAGE_KEY = "theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme() {
  return document.documentElement.dataset.theme || (media.matches ? "dark" : "light");
}

function save(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable */ }
}

function notify() {
  window.dispatchEvent(new CustomEvent("themechange", { detail: currentTheme() }));
}

export function initThemeToggle(button) {
  const render = () => {
    const dark = currentTheme() === "dark";
    button.textContent = dark ? "☀️" : "🌙";
    button.setAttribute("aria-label", dark ? "Switch to day theme" : "Switch to night theme");
    button.title = button.getAttribute("aria-label");
  };
  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    save(next);
    render();
    notify();
  });
  media.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) { render(); notify(); }
  });
  render();
}

/** Read a CSS custom property from the active theme. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
