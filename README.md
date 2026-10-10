# Live Word Cloud

A real-time, crowd-sourced word cloud for classrooms, workshops and meetings.
The presenter puts a topic and a QR code on the screen; participants scan it with
their phones and submit words or short phrases; the cloud grows live as ideas
arrive.

- **Hosted for free on GitHub Pages**: static HTML, CSS and JS with no build step
- **Real-time sync** through Firebase Realtime Database (free Spark plan)
- **Day and night themes** that follow the device setting, with a manual toggle
- **QR code join**: no app install and no participant login
- **Many participants at once**: a typical class or audience (hundreds) works on the free tier

---

## Table of contents

1. [How it works](#how-it-works)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Data model](#data-model)
6. [Setup](#setup)
7. [Deploying to GitHub Pages](#deploying-to-github-pages)
8. [Using the app](#using-the-app)
9. [Theming](#theming)
10. [Word processing rules](#word-processing-rules)
11. [Limits and troubleshooting](#limits-and-troubleshooting)
12. [Roadmap](#roadmap)

---

## How it works

GitHub Pages only serves static files, so it cannot receive submissions from
phones itself. A hosted real-time database does that job instead.
Every browser (the presenter's screen and each participant's phone) connects
directly to Firebase:

```
 ┌──────────────────────┐          ┌──────────────────────────┐
 │  Presenter screen    │          │  Participant phones      │
 │  index.html          │          │  join.html?s=ABC123      │
 │  - topic + QR code   │          │  - topic                 │
 │  - live word cloud   │          │  - text box + Submit     │
 └─────────┬────────────┘          └────────────┬─────────────┘
           │  subscribe (onValue)               │  push word
           │                                    │
           ▼                                    ▼
      ┌─────────────────────────────────────────────────┐
      │      Firebase Realtime Database (free tier)     │
      │      /sessions/ABC123/{meta, words}             │
      └─────────────────────────────────────────────────┘
                 ▲
                 │  static files only
      ┌──────────┴──────────┐
      │    GitHub Pages     │
      └─────────────────────┘
```

1. The presenter opens the site and creates a **session**. The app generates a
   6-character code (for example `ABC123`) and a QR code that points to
   `https://<user>.github.io/<repo>/join.html?s=ABC123`.
2. Participants scan the QR code (or type the code) and submit ideas.
3. Each submission is written to `/sessions/ABC123/words`.
4. The presenter's page listens for changes, counts how often each word appears
   and redraws the cloud within about a second. Words submitted more often are drawn larger.

> **Why Firebase?** It has a generous free tier, a browser SDK that loads
> straight from a CDN with no bundler, anonymous authentication, and
> security rules that let you lock down writes without running a server.
> See [Alternatives](#alternatives-to-firebase) if you prefer something else.

---

## Features

### Presenter view (`index.html`)
- Create a session with a topic or question, such as *"One word that describes today's lesson"*
- Large QR code and join code, with a toggle to hide the QR once everyone has joined
- Live word cloud that animates as words arrive
- Live counters for participants and submissions
- Controls:
  - **Pause or resume** submissions
  - **Moderate**: click a word to hide it (for example a typo or an inappropriate word)
  - **Clear** all words
  - **Export** the cloud as PNG and the raw data as CSV
  - **Fullscreen** mode for projectors
- Day and night theme toggle

### Participant view (`join.html`)
- Mobile-first layout with large tap targets
- Shows the topic, a text box (40-character limit) and a Submit button
- Lets each person submit several ideas, with a configurable limit (default 3)
- Gives instant feedback ("Thanks! Your idea was added") and shows the person's own submissions
- Shows a friendly message when the session is paused or closed
- Follows the phone's light or dark setting automatically

---

## Tech stack

| Concern            | Choice                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Hosting            | GitHub Pages                                                           |
| Real-time backend  | Firebase Realtime Database + Anonymous Auth (modular JS SDK via CDN)  |
| Word cloud         | [d3-cloud](https://github.com/jasondavies/d3-cloud) layout, drawn on a canvas |
| QR code            | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) |
| UI                 | Plain HTML, CSS custom properties and ES modules, with no framework or build step |

All libraries load from CDNs with pinned versions, so the repo stays
plain static files that GitHub Pages can serve directly.

---

## Project structure

```
WordCloud/
├── index.html              # Presenter: create session, QR code, live cloud
├── join.html               # Participant: submit ideas from a phone
├── css/
│   └── styles.css          # Layout + light/dark theme tokens
├── js/
│   ├── firebase-config.js  # Your Firebase project config (public keys)
│   ├── db.js               # Firebase init, auth, read/write helpers
│   ├── present.js          # Presenter logic: session, QR, cloud rendering
│   ├── join.js             # Participant logic: submit, limits, feedback
│   ├── words.js            # Normalisation, stop words, profanity filter
│   ├── theme.js            # Day/night toggle, persisted in localStorage
│   └── ui.js               # Small DOM helpers (toast, storage, URL params)
├── assets/
│   └── favicon.svg
├── database.rules.json     # Firebase security rules (copy into console)
├── .nojekyll               # Serve files as-is on GitHub Pages
└── README.md
```

---

## Data model

```jsonc
{
  "sessions": {
    "ABC123": {
      "meta": {
        "topic": "One word that describes today's lesson",
        "owner": "<presenter anonymous uid>",
        "open": true,              // false = submissions paused
        "maxPerUser": 3,
        "createdAt": 1760000000000
      },
      "words": {
        "-Nx1a...": { "text": "inspiring", "uid": "<participant uid>", "ts": 1760000001234 },
        "-Nx1b...": { "text": "fun",       "uid": "<participant uid>", "ts": 1760000002345 }
      },
      "hidden": {
        "badword": true            // words the presenter moderated out
      }
    }
  }
}
```

- Each submission is stored separately, rather than as a running count. This prevents two people overwriting each other's update when they submit at the same moment, and it makes the CSV export possible.
- The presenter's browser groups the words and counts them.

---

## Setup

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and click **Add project**. Google Analytics is not needed.
2. Go to **Build → Realtime Database → Create database**. Choose the region closest to you and start in **locked mode**.
3. Go to **Build → Authentication → Get started → Sign-in method** and enable **Anonymous**.
4. Go to **Project settings → General → Your apps → Web (`</>`)** and register an app. Copy the `firebaseConfig` object.

### 2. Add your config
Paste your values into `js/firebase-config.js`. Keep the `export` keyword, because the other scripts import this object by name:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  appId: "1:1234567890:web:abcdef"
};
```

> Firebase web API keys are **not secrets**. They identify your project, and
> the security rules below are what protect your data. It is safe to commit
> this file to a public repo.

### 3. Apply the security rules
Paste the contents of `database.rules.json` into **Realtime Database → Rules** and click Publish. The file also adds an index on `uid` so each phone can efficiently load only its own submissions. The core rules are:

```json
{
  "rules": {
    "sessions": {
      "$code": {
        ".read": true,
        "meta": {
          ".write": "auth != null && (!data.exists() || data.child('owner').val() === auth.uid)",
          ".validate": "newData.child('owner').val() === auth.uid && newData.child('topic').isString() && newData.child('topic').val().length <= 200"
        },
        "hidden": {
          ".write": "auth != null && root.child('sessions/' + $code + '/meta/owner').val() === auth.uid"
        },
        "words": {
          ".write": "auth != null && root.child('sessions/' + $code + '/meta/owner').val() === auth.uid",
          "$wordId": {
            ".write": "auth != null && !data.exists() && root.child('sessions/' + $code + '/meta/open').val() === true",
            ".validate": "newData.hasChildren(['text', 'uid', 'ts']) && newData.child('text').isString() && newData.child('text').val().length > 0 && newData.child('text').val().length <= 40 && newData.child('uid').val() === auth.uid && newData.child('ts').val() === now"
          }
        }
      }
    }
  }
}
```

What these rules enforce:
- Anyone can **read** a session, so the presenter screen and phones can display it.
- Only the presenter who created a session can change its topic, pause it, hide words or clear it.
- Participants can only **add** new words, and only while the session is open. They cannot edit or delete words.
- Each word must be 1–40 characters, be tagged with the sender's own uid and use a server timestamp.

The per-user submission limit (`maxPerUser`) is enforced in the participant
page. For stricter limits, see the [Roadmap](#roadmap).

### 4. Run locally
ES modules do not load from `file://` URLs, so serve the folder over HTTP:

```bash
# any one of these
npx serve .
python -m http.server 8080
```

Open <http://localhost:8080>. To test from a phone on the same Wi-Fi, use your
computer's LAN IP address instead of `localhost`, for example `http://192.168.1.20:8080`.
The QR code uses the current page's address, so this works without any changes.

---

## Deploying to GitHub Pages

1. Push the project to a GitHub repository, for example `WordCloud`.
2. In the repo, open **Settings → Pages**.
3. Under **Build and deployment**, set *Source* to **Deploy from a branch**, then choose **`main`** and **`/ (root)`**.
4. Wait about a minute. The site will be live at `https://<your-username>.github.io/WordCloud/`.
5. In Firebase, open **Authentication → Settings → Authorized domains** and add
   `<your-username>.github.io`. Without this step, anonymous sign-in fails on the deployed site.

GitHub Pages serves over HTTPS by default, which Firebase requires. Any phone camera that reads QR codes can open the join link.

---

## Using the app

**Presenter**
1. Open the site on the computer connected to the projector.
2. Type the topic or question and click **Start session**.
3. Leave the QR code on screen while people join. Hide it once most have joined so the cloud gets more room.
4. Watch the cloud grow. Click a word to hide it, or use **Pause** to stop new submissions.
5. When you are done, use **Export PNG** to save the cloud or **Export CSV** to save the raw data.

**Participants**
1. Scan the QR code with the phone camera, or go to the site and enter the 6-character code.
2. Type an idea and tap **Submit**. Repeat until you reach the limit.

Sessions persist, so the presenter can refresh the page or reopen
`index.html?s=ABC123` on the same browser and keep control of the session.

---

## Theming

Themes are built with CSS custom properties and a `data-theme` attribute on `<html>`:

```css
:root {
  --bg: #f7f7fb;  --fg: #1d1d27;  --card: #ffffff;  --accent: #4f46e5;
  --cloud-palette: #4f46e5, #0891b2, #059669, #d97706, #db2777;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1117;  --fg: #e8e8f0;  --card: #1a1d27;  --accent: #818cf8;
    --cloud-palette: #818cf8, #22d3ee, #34d399, #fbbf24, #f472b6;
  }
}
:root[data-theme="dark"] { /* same dark values as above */ }
```

- On first load, the app follows the operating system's light or dark setting.
- The ☀️/🌙 toggle overrides it and saves the choice in `localStorage`.
- When the theme changes, the word cloud is redrawn using that theme's colours (`--cloud-palette`) and background, so words stay readable on a projector in either mode.
- The QR code is always drawn dark-on-light with a quiet border, because some phone scanners have trouble reading inverted QR codes.

---

## Word processing rules

`js/words.js` applies these rules before a word is submitted and again before it is counted:

1. **Trim and collapse whitespace**, and remove surrounding punctuation.
2. **Lowercase** the word for counting, while displaying the most common original spelling.
3. **Allow phrases** of up to 3 words (for example "team work"), counted as one item.
4. **Filter stop words**, ignoring entries such as "the", "and" or "a" on their own.
5. **Filter profanity** with a small built-in blocklist that you can edit in `words.js`. Presenter moderation catches anything the list misses.
6. **Scale sizes** with a square-root curve, so a single very popular word does not shrink everything else to nothing.

---

## Limits and troubleshooting

**Firebase Spark (free) plan limits:**

| Limit                  | Value       | What it means in practice               |
| ---------------------- | ----------- | --------------------------------------- |
| Simultaneous connections | 100       | About 99 phones plus 1 presenter at once |
| Storage                | 1 GB        | Millions of words                        |
| Download               | 10 GB/month | Plenty for regular class use             |

For audiences larger than about 100 people, upgrade to the pay-as-you-go **Blaze** plan
(it includes 200k connections and costs very little at this scale). Another option is to have
participants disconnect after they submit; `join.js` can call `goOffline()` after the last allowed submission.

| Problem | Fix |
| ------- | --- |
| `auth/operation-not-allowed` | Enable **Anonymous** sign-in in Firebase Authentication |
| Works locally but not on GitHub Pages | Add `<user>.github.io` to Firebase **Authorized domains** |
| `PERMISSION_DENIED` on submit | The session is paused, or the word is longer than 40 characters |
| Blank page, module errors in console | You opened the file via `file://`; serve it over HTTP |
| Phones can't open the local test URL | Use the computer's LAN IP address, and allow the port through the firewall |

### Alternatives to Firebase
- **Supabase** (Postgres with Realtime): a similar setup that uses Row Level Security policies instead of Firebase rules.
- **PeerJS / WebRTC**: the presenter's browser acts as the hub, so you don't need a database account. Some school and corporate networks block WebRTC, and everything is lost when the presenter's tab closes.

---

## Roadmap

- [ ] Stricter server-side rate limit per user (`/sessions/$code/counts/$uid` checked in rules)
- [ ] Optional presenter PIN for reclaiming a session from another device
- [ ] Multiple questions per session, shown one after another
- [ ] Shape masks (heart, lightbulb) and font choices
- [ ] Translation and accessibility pass (screen-reader list view of the words)
- [ ] Automatic cleanup of sessions older than 30 days

---

## License

MIT
