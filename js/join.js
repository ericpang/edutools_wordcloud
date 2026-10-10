// Participant page: enter a code (or arrive via QR), submit ideas.

import * as db from "./db.js";
import { validate, MAX_LEN } from "./words.js";
import { initThemeToggle } from "./theme.js";
import { $, show, sessionCodeFromUrl } from "./ui.js";

const state = {
  code: null,
  uid: null,
  meta: null,
  mine: [],         // this participant's submissions, oldest first
  submitting: false,
};

initThemeToggle($("#theme-toggle"));
main().catch((err) => {
  console.error(err);
  showMessage("⚠️", "Couldn't connect", "Check your internet connection and try again.");
});

async function main() {
  if (!db.isConfigured) return show($("#config-banner"));

  const code = sessionCodeFromUrl();
  if (!code) return showCodeEntry();

  state.code = code;
  state.uid = await db.ready();
  $("#session-code").textContent = code;

  db.watchMeta(code, (meta) => {
    state.meta = meta;
    render();
  });
  db.watchMyWords(code, state.uid, (words) => {
    state.mine = Object.values(words).sort((a, b) => a.ts - b.ts);
    render();
  });

  wireForm();
}

function showCodeEntry() {
  show($("#enter-code"));
  const input = $("#code-input");
  input.focus();
  $("#code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = input.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (code.length === 6) location.search = `?s=${code}`;
  });
}

function showMessage(emoji, title, body) {
  show($("#session"), false);
  show($("#message"));
  $("#message-emoji").textContent = emoji;
  $("#message-title").textContent = title;
  $("#message-body").textContent = body;
}

function limit() {
  return state.meta?.maxPerUser || Infinity; // 0 = unlimited
}

function render() {
  const { meta } = state;
  if (meta === null) {
    return showMessage("🔍", "Session not found", `There's no session with code ${state.code}. Check the code and try again.`);
  }
  if (!meta) return;

  show($("#message"), false);
  show($("#session"));
  $("#topic").textContent = meta.topic;
  document.title = `${meta.topic} · Live Word Cloud`;

  const used = state.mine.length;
  const left = limit() - used;
  const open = meta.open !== false;
  const done = left <= 0;

  $("#remaining").textContent = Number.isFinite(left) ? `${Math.max(left, 0)} of ${limit()} left` : "";
  $("#idea").disabled = !open || done;
  $("#submit-btn").disabled = !open || done || state.submitting;

  if (!open) setStatus("Submissions are paused. Hang tight!", "");
  else if (done) setStatus("Thanks! You've shared all your ideas. 🎉", "ok");
  else if ($("#status").dataset.sticky !== "1") setStatus("", "");

  const list = $("#mine");
  list.replaceChildren(...state.mine.map((w) => {
    const li = document.createElement("li");
    li.textContent = w.text;
    return li;
  }));
  show($("#mine-wrap"), used > 0);
}

function setStatus(text, kind, sticky = false) {
  const el = $("#status");
  el.textContent = text;
  el.className = `status ${kind}`;
  el.dataset.sticky = sticky ? "1" : "";
}

function wireForm() {
  const input = $("#idea");
  const counter = $("#char-count");
  const updateCounter = () => { counter.textContent = `${input.value.length}/${MAX_LEN}`; };
  input.addEventListener("input", () => { updateCounter(); setStatus("", ""); });

  $("#idea-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.submitting) return;

    const result = validate(input.value);
    if (!result.ok) return setStatus(result.error, "error", true);
    if (state.mine.some((w) => w.text.toLocaleLowerCase() === result.key)) {
      return setStatus("You've already added that one. Try something different.", "error", true);
    }
    if (state.mine.length >= limit()) return;

    state.submitting = true;
    render();
    try {
      await db.submitWord(state.code, state.uid, result.text);
      input.value = "";
      updateCounter();
      setStatus(`Thanks! "${result.text}" was added.`, "ok", true);
    } catch (err) {
      console.error(err);
      const denied = String(err?.code || err?.message).toLowerCase().includes("permission");
      setStatus(denied ? "Submissions are paused right now." : "Couldn't send. Check your connection and try again.", "error", true);
    } finally {
      state.submitting = false;
      render();
      if (!input.disabled) input.focus();
    }
  });
}
