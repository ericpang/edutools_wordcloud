// Word normalisation, filtering and aggregation shared by both pages.

export const MAX_LEN = 40;
export const MAX_WORDS = 3;

const STOP_WORDS = new Set(`
a an the and or but nor so yet of to in on at by for with from up down out over under
is am are was were be been being do does did have has had i me my we us our you your
he him his she her it its they them their this that these those there here what which
who whom whose when where why how all any some no not just very too also than then
can could will would shall should may might must ok okay yes yeah idk none nothing
`.trim().split(/\s+/));

// Kept deliberately short; presenter moderation catches what this misses.
// Stems match at the start of a word (avoids flagging e.g. "Scunthorpe"); "fuck" matches anywhere.
const BLOCKED_STEMS = /^(shit|cunt|nigg|fagg|motherf)|fuck/;
const BLOCKED_WORDS = new Set(`
ass arse asshole arsehole bullshit bitch bastard bollocks cock dick dickhead piss prick pussy
slut whore wanker twat retard fag tits boobs
`.trim().split(/\s+/));

/** Trim, collapse whitespace and strip surrounding punctuation. Keeps the user's casing. */
export function normalize(raw) {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** Case-insensitive key used for counting. */
export const toKey = (text) => normalize(text).toLocaleLowerCase();

/** Firebase keys cannot contain . $ # [ ] / */
export const toDbKey = (key) => encodeURIComponent(key).replace(/\./g, "%2E");
export const fromDbKey = (dbKey) => decodeURIComponent(dbKey);

export function isStopWord(key) {
  return !key.includes(" ") && STOP_WORDS.has(key);
}

export function isBlocked(key) {
  return key
    .split(/[\s\-']+/)
    .map((t) => t.replace(/[^\p{L}]/gu, ""))
    .some((t) => BLOCKED_WORDS.has(t) || BLOCKED_STEMS.test(t));
}

/** Validate a participant's input. Returns { ok, text, key } or { ok: false, error }. */
export function validate(raw) {
  const text = normalize(raw);
  if (!text) return { ok: false, error: "Type a word or short phrase first." };
  if (text.length > MAX_LEN) return { ok: false, error: `Keep it to ${MAX_LEN} characters or fewer.` };
  if (text.split(" ").length > MAX_WORDS) return { ok: false, error: `Keep it to ${MAX_WORDS} words or fewer.` };
  const key = text.toLocaleLowerCase();
  if (isStopWord(key)) return { ok: false, error: "Try a more meaningful word." };
  if (isBlocked(key)) return { ok: false, error: "Let's keep it friendly. Try another word." };
  return { ok: true, text, key };
}

/**
 * Group raw submissions into counted ideas.
 * @param {Record<string, {text: string}>} words
 * @param {Set<string>} hidden keys the presenter moderated out
 * @returns {{key: string, text: string, count: number}[]} sorted by count, descending
 */
export function aggregate(words, hidden = new Set()) {
  const groups = new Map();
  for (const w of Object.values(words || {})) {
    const text = normalize(w?.text);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (hidden.has(key) || isStopWord(key) || isBlocked(key)) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, count: 0, variants: new Map() }));
    g.count++;
    g.variants.set(text, (g.variants.get(text) || 0) + 1);
  }
  return [...groups.values()]
    .map(({ key, count, variants }) => ({
      key,
      count,
      // Display the most common original spelling
      text: [...variants].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
