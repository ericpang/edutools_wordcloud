// Firebase initialisation and all database reads/writes.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, remove, onValue,
  query, orderByChild, equalTo, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes("YOUR_"));

let auth, db;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}

/**
 * Sign in anonymously. Firebase persists the anonymous user in this browser and
 * returns the same one on later visits, so the presenter keeps ownership on refresh.
 */
export async function ready() {
  const { user } = await signInAnonymously(auth);
  return user.uid;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

function randomCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const sessionRef = (code, path = "") => ref(db, `sessions/${code}${path ? "/" + path : ""}`);

export async function createSession(uid, topic, maxPerUser) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    if ((await get(sessionRef(code, "meta"))).exists()) continue;
    await set(sessionRef(code, "meta"), {
      topic, owner: uid, open: true, maxPerUser, createdAt: serverTimestamp(),
    });
    return code;
  }
  throw new Error("Could not allocate a session code. Please try again.");
}

export async function getMeta(code) {
  const snap = await get(sessionRef(code, "meta"));
  return snap.exists() ? snap.val() : null;
}

/** Presenter: subscribe to the whole session. Returns an unsubscribe function. */
export function watchSession(code, callback) {
  return onValue(sessionRef(code), (snap) => callback(snap.val()));
}

/** Participant: subscribe to session metadata only (keeps phone traffic small). */
export function watchMeta(code, callback) {
  return onValue(sessionRef(code, "meta"), (snap) => callback(snap.val()));
}

/** Participant: subscribe to this user's own submissions. */
export function watchMyWords(code, uid, callback) {
  const q = query(sessionRef(code, "words"), orderByChild("uid"), equalTo(uid));
  return onValue(q, (snap) => callback(snap.val() || {}));
}

export function submitWord(code, uid, text) {
  return push(sessionRef(code, "words"), { text, uid, ts: serverTimestamp() });
}

export const setOpen = (code, open) => update(sessionRef(code, "meta"), { open });
export const hideWord = (code, dbKey) => set(sessionRef(code, `hidden/${dbKey}`), true);
export const unhideWord = (code, dbKey) => remove(sessionRef(code, `hidden/${dbKey}`));
export const clearWords = (code) => remove(sessionRef(code, "words"));
