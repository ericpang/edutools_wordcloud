// Presenter page: create/resume a session, show the QR code, render the live cloud.

import * as db from "./db.js";
import { aggregate, toKey, toDbKey, fromDbKey } from "./words.js";
import { initThemeToggle, cssVar } from "./theme.js";
import { $, toast, show, storageGet, storageSet, sessionCodeFromUrl } from "./ui.js";

const LAST_SESSION_KEY = "lastSession";
const MAX_CLOUD_WORDS = 150;
const FONT = "Nunito, system-ui, sans-serif";

const state = {
  code: null,
  isOwner: false,
  session: null,   // raw session snapshot
  ideas: [],       // aggregated [{key, text, count}]
  placed: [],      // drawn words with bounding boxes, for click hit-testing
};

initThemeToggle($("#theme-toggle"));
main().catch((err) => {
  console.error(err);
  toast(friendlyError(err), 6000);
});

async function main() {
  if (!db.isConfigured) {
    show($("#config-banner"));
    show($("#setup"));
    $("#start-btn").disabled = true;
    return;
  }

  const uid = await db.ready();
  const code = sessionCodeFromUrl();

  if (code) {
    const meta = await db.getMeta(code);
    if (meta) return startBoard(code, meta.owner === uid);
    toast(`Session ${code} was not found.`);
    history.replaceState(null, "", location.pathname);
  }
  showSetup(uid);
}

/* ---------- Setup ---------- */

function showSetup(uid) {
  show($("#setup"));
  $("#topic-input").focus();

  const last = storageGet(LAST_SESSION_KEY);
  if (last) {
    const link = $("#resume-link");
    link.textContent = last;
    link.href = `?s=${encodeURIComponent(last)}`;
    show($("#resume"));
  }

  $("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("#topic-input").value.trim();
    if (!topic) return;
    const btn = $("#start-btn");
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      const code = await db.createSession(uid, topic, Number($("#max-input").value));
      history.replaceState(null, "", `?s=${code}`);
      show($("#setup"), false);
      startBoard(code, true);
    } catch (err) {
      console.error(err);
      toast(friendlyError(err), 6000);
      btn.disabled = false;
      btn.textContent = "Start session";
    }
  });
}

/* ---------- Board ---------- */

function startBoard(code, isOwner) {
  state.code = code;
  state.isOwner = isOwner;
  if (isOwner) storageSet(LAST_SESSION_KEY, code);

  show($("#board"));
  show($("#join-pill"));
  $("#code").textContent = code;
  $("#pill-code").textContent = code;

  const joinUrl = new URL(`join.html?s=${code}`, location.href).href;
  $("#join-url").textContent = joinUrl.replace(/^https?:\/\//, "");
  renderQr(joinUrl);

  // Viewers who don't own the session (e.g. a second screen) get a read-only board
  show($("#controls"), isOwner);
  show($("#hint"), isOwner);
  wireControls();
  if (isOwner) wireCloudInteraction();

  db.watchSession(code, (session) => {
    state.session = session || {};
    onSessionChange();
  });

  new ResizeObserver(() => scheduleRender()).observe($("#cloud-wrap"));
  window.addEventListener("themechange", () => scheduleRender());
  document.fonts?.load(`800 40px Nunito`).then(() => scheduleRender(), () => {});
}

function renderQr(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  $("#qr").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

function onSessionChange() {
  const { meta = {}, words = {}, hidden = {} } = state.session;
  const hiddenKeys = new Set(Object.keys(hidden).map(fromDbKey));

  $("#topic").textContent = meta.topic || "";
  document.title = meta.topic ? `${meta.topic} · Live Word Cloud` : "Live Word Cloud";

  const open = meta.open !== false;
  show($("#paused-badge"), !open);
  $("#pause-btn").textContent = open ? "⏸ Pause" : "▶ Resume";

  state.ideas = aggregate(words, hiddenKeys);

  const entries = Object.values(words);
  $("#stat-total").textContent = entries.length;
  $("#stat-unique").textContent = state.ideas.length;
  $("#stat-people").textContent = new Set(entries.map((w) => w.uid)).size;

  renderHiddenList(hiddenKeys);
  scheduleRender();
}

function renderHiddenList(hiddenKeys) {
  const list = $("#hidden-list");
  list.replaceChildren();
  for (const key of hiddenKeys) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = key;
    btn.title = "Restore this word";
    btn.disabled = !state.isOwner;
    btn.addEventListener("click", () => db.unhideWord(state.code, toDbKey(key)).catch(onActionError));
    li.append(btn);
    list.append(li);
  }
  show($("#hidden-panel"), hiddenKeys.size > 0);
}

/* ---------- Cloud rendering ---------- */

let renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderCloud(), 250);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Small seeded PRNG so the layout stays stable between redraws. */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Choose font sizes so the words roughly fill the canvas: relative weight follows
 * a square-root curve, then everything is scaled to fit the available area.
 */
function computeSizes(ideas, width, height) {
  const maxCount = ideas[0]?.count || 1;
  const rel = ideas.map((i) => 0.3 + 0.7 * Math.sqrt(i.count / maxCount));
  // Approximate area per word: font-size² × characters × avg glyph width
  const areaUnits = ideas.reduce((sum, i, n) => sum + rel[n] ** 2 * (i.text.length + 1) * 0.62, 0);
  const scale = Math.sqrt((width * height * 0.5) / areaUnits);
  const minSize = Math.max(12, Math.min(width, height) * 0.022);
  return ideas.map((i, n) => {
    const fitWidth = (width * 0.9) / (i.text.length * 0.62);
    return Math.max(minSize, Math.min(scale * rel[n], height * 0.3, fitWidth));
  });
}

let layout = null;

/**
 * Lay out in CSS pixels with d3-cloud, then paint at device resolution.
 * If some words don't fit, retry with everything slightly smaller.
 */
function renderCloud(attempt = 0, shrink = 1) {
  layout?.stop();
  const wrap = $("#cloud-wrap");
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  if (!width || !height) return;

  const ideas = state.ideas.slice(0, MAX_CLOUD_WORDS);
  show($("#empty"), ideas.length === 0);
  if (!ideas.length) return paint(width, height, []);

  const sizes = computeSizes(ideas, width, height);
  const words = ideas.map((i, n) => ({ text: i.text, key: i.key, size: sizes[n] * shrink }));

  layout = d3.layout.cloud()
    .size([width, height])
    .words(words)
    .font(FONT)
    .fontWeight(800)
    .fontSize((d) => d.size)
    .rotate(0) // horizontal words read best on a projector
    .padding((d) => Math.max(2, d.size * 0.06))
    .random(seededRandom(42))
    .on("end", (placed) => {
      if (placed.length < words.length && attempt < 5) renderCloud(attempt + 1, shrink * 0.85);
      else paint(width, height, placed);
    })
    .start();
}

function paint(width, height, placed) {
  const canvas = $("#cloud");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = cssVar("--cloud-bg");
  ctx.fillRect(0, 0, width, height);

  const palette = cssVar("--cloud-palette").split(",").map((c) => c.trim());
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Centre the whole cloud: d3-cloud starts words at random points near the middle
  const minX = Math.min(...placed.map((d) => d.x + d.x0));
  const maxX = Math.max(...placed.map((d) => d.x + d.x1));
  const minY = Math.min(...placed.map((d) => d.y + d.y0));
  const maxY = Math.max(...placed.map((d) => d.y + d.y1));
  const offsetX = width / 2 - (minX + maxX) / 2;
  const offsetY = height / 2 - (minY + maxY) / 2;

  state.placed = placed.map((d) => {
    // Same font string d3-cloud used when measuring the word
    ctx.font = `normal 800 ${d.size + 1}px ${FONT}`;
    ctx.fillStyle = palette[hash(d.key) % palette.length];
    const x = offsetX + d.x;
    const y = offsetY + d.y;
    ctx.fillText(d.text, x, y);
    const m = ctx.measureText(d.text);
    return {
      key: d.key, text: d.text,
      x0: x - m.width / 2, x1: x + m.width / 2,
      y0: y - m.actualBoundingBoxAscent, y1: y + m.actualBoundingBoxDescent,
    };
  });
}

function wordAt(event) {
  const rect = $("#cloud").getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return state.placed.find((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
}

function wireCloudInteraction() {
  const canvas = $("#cloud");
  canvas.addEventListener("mousemove", (e) => { canvas.style.cursor = wordAt(e) ? "pointer" : "default"; });
  canvas.addEventListener("click", async (e) => {
    const word = wordAt(e);
    if (!word || !confirm(`Hide "${word.text}" from the cloud?`)) return;
    try {
      await db.hideWord(state.code, toDbKey(word.key));
      toast(`Hidden "${word.text}". Restore it from the sidebar.`);
    } catch (err) { onActionError(err); }
  });
}

/* ---------- Controls ---------- */

function wireControls() {
  $("#pause-btn").addEventListener("click", () => {
    const open = state.session?.meta?.open !== false;
    db.setOpen(state.code, !open)
      .then(() => toast(open ? "Submissions paused" : "Submissions open"))
      .catch(onActionError);
  });

  $("#qr-btn").addEventListener("click", () => {
    const panel = $("#qr-panel");
    const hide = !panel.hidden;
    show(panel, !hide);
    $("#board").classList.toggle("qr-hidden", hide);
    $("#qr-btn").textContent = hide ? "Show QR" : "Hide QR";
  });

  $("#clear-btn").addEventListener("click", () => {
    if (!confirm("Delete all submitted words? This cannot be undone.")) return;
    db.clearWords(state.code).then(() => toast("Cloud cleared")).catch(onActionError);
  });

  $("#fullscreen-btn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });

  $("#png-btn").addEventListener("click", () => {
    download(`wordcloud-${state.code}.png`, $("#cloud").toDataURL("image/png"));
  });

  $("#csv-btn").addEventListener("click", () => {
    const rows = [["text", "normalized", "participant", "submitted_at"]];
    const words = Object.values(state.session?.words || {}).sort((a, b) => a.ts - b.ts);
    for (const w of words) {
      rows.push([w.text, toKey(w.text), w.uid.slice(0, 8), new Date(w.ts).toISOString()]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    download(`wordcloud-${state.code}.csv`, url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function download(filename, href) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

function onActionError(err) {
  console.error(err);
  toast(friendlyError(err), 5000);
}

function friendlyError(err) {
  const msg = String(err?.code || err?.message || err);
  if (msg.includes("operation-not-allowed")) return "Enable Anonymous sign-in in Firebase Authentication.";
  if (msg.includes("unauthorized-domain")) return "Add this domain to Firebase Authentication → Authorized domains.";
  if (msg.toLowerCase().includes("permission")) return "Permission denied. Check your Firebase database rules.";
  return "Something went wrong. Check the browser console for details.";
}
