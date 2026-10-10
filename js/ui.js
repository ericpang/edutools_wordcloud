// Small DOM helpers shared by both pages.

export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer;
export function toast(message, ms = 2600) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

export function show(el, visible = true) {
  el.hidden = !visible;
}

export function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function sessionCodeFromUrl() {
  const code = new URLSearchParams(location.search).get("s");
  return code ? code.trim().toUpperCase() : null;
}
