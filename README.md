# Flashcards Library (React + Vite)

## Overview

Flashcards Library is a single-page React application for studying vocabulary decks in a card-flip workflow. The app ships with starter decks, lets you create additional decks under predefined source sections, supports bulk card import from pasted text (including Quizlet-style tab-separated rows), and syncs your library and study progress through the bundled Node API.

## Project Type

This repository is a Vite React app with a small Node API server for cloud library sync.

## Current Features (verified from code)

- Browse decks grouped into three library sections: **GPT**, **Wikipedia**, and **Oxford Dictionaries**.
- Study cards with a two-sided flashcard UI (term/definition) and flip interactions.
- Navigate cards with buttons and keyboard shortcuts:
  - `Space` / `Enter`: flip card
  - `Left` / `Right`: previous/next card
  - `K`: mark/unmark current card as known
  - `S`: shuffle current deck for this session
  - `1`–`4`: grade the current card during a review session (Again/Hard/Good/Easy)
- Track progress per deck:
  - known card count
  - remaining card count
  - progress meter
  - optional “Only remaining” study mode
- Study with spaced repetition:
  - grade a card Again / Hard / Good / Easy; each button shows when the card
    would next come back
  - an SM-2 style schedule is stored per card and syncs with the library
  - **Review** in the study view works through cards that are due now, most
    overdue first, then cards that have never been graded. A card answered
    Again really does wait its ten minutes; when the queue empties the deck
    says when the next card is coming back
  - the home page lists how many cards the day holds and which decks they are
    in, counting cards scheduled for later today as well as ones ready now
- Shuffle is session-only: it changes the order you study in, not the deck
  itself, and **Unshuffle** puts it back.
- Search decks _and_ cards from the home page. Card hits open the deck at the
  matching card.
- Create new decks inside any section.
- Bulk import cards when creating a deck or appending to an existing one.
- Parse pasted lines in multiple formats:
  - `term<TAB>definition` (Quizlet-style)
  - `term - definition` (supports spaced hyphen/en dash/em dash)
  - `term: definition`
  - `term-definition`
- Share a single deck with a link: **Share deck** in the study view publishes a
  copy and copies a `/d/<shareId>` URL to the clipboard. Opening that link
  previews the deck and offers to add it to your own library.
- Persist state in cloud sync storage:
  - library/deck content
  - per-deck study progress, including review schedules
  - selected deck
  - preferences: pinned decks, recently viewed decks, theme and accent colour
- Download the whole library as a JSON backup file and restore it later
  (**⋯ → ☁ Sync → Backup file**).
- Includes starter deck data in `src/data`:
  - `Positive Adjectives`
  - `emotions1`

## Tech Stack

- **Runtime/UI:** React 18
- **Language:** TypeScript
- **Bundler/Dev server:** Vite 5
- **React integration:** `@vitejs/plugin-react`
- **Styling:** Plain CSS (`src/styles.css`)
- **Persistence:** PostgreSQL when `DATABASE_URL` is configured; in-memory API storage otherwise

## Requirements

- Node.js 18+ (Node 20 LTS recommended)
- npm (project includes `package-lock.json`)

## Install Dependencies

```bash
npm install
```

## Run Locally (Development)

```bash
npm run dev
```

Vite will print the local URL (typically `http://localhost:5173`).

## Build

```bash
npm run build
```

This runs TypeScript project build checks (`tsc -b`) and then creates a production bundle with Vite.

## Production Preview / Start

To run the built app locally in production mode:

```bash
npm run build
npm run start
```

The production server serves `dist/` and the `/api/*` sync routes on the same port.

## Cloud Sync

### How two devices are merged

Snapshots are version 2. Every section, deck, card and per-deck progress entry
carries an optional `updatedAt`, and the snapshot carries deletion tombstones
for sections, decks and cards. Merging is deterministic:

**Library content**

- A tombstone removes the entity on both devices, so deletes actually
  propagate instead of being undone by whichever device still had the item.
- A tombstone loses to an entity edited or re-created after the delete.
- Deleting a deck records one tombstone for the deck, not one per card — a
  large deck would otherwise blow the snapshot's tombstone budget. Cards and
  decks are checked against their container's tombstone as well as their own,
  which is what stops a stale device injecting the old contents of a deck or
  topic whose slug-derived id has since been re-used.
- Tombstones expire after 90 days, which bounds snapshot growth; a device
  offline longer than that can resurrect what it still holds.
- Two edits to the same id are settled by `updatedAt`, newest wins.

**Study progress** merges per card, not per deck. Taking one device's whole
progress object would mean a card graded on the phone is erased the moment the
laptop so much as navigates — the two were never really in conflict, they
touched different cards.

- Review schedules merge per card, keeping the later `lastReviewedAt`.
- Known marks merge per card using `knownUpdatedAt`, which records when each
  card's known state last changed either way. A side with a stamp beats one
  without, so an explicit unmark wins over a mark carried by a client too old
  to stamp anything.
- Where neither side has ever stamped a card, marks are unioned — the
  behaviour from before stamps existed, so upgrading drops nothing.
- Reset progress sets `resetAt` and stamps every cleared card, so the reset
  propagates instead of being refilled by whichever device still holds the
  old marks and schedules.
- `currentCardId` and `studyMode` merge under `positionUpdatedAt`, which only
  moves when the user actually navigates or changes mode. Flipping a card
  isn't a move, and `isFlipped` is never taken from the other device.

**Preferences**: pins, theme and accent move as one timestamped group; view
times merge per deck by keeping the later one.

Every tie falls to the local device, so repeated merges converge.

Version 1 snapshots are read and upgraded, and the server still accepts them,
so a device that has not been reloaded keeps syncing.

New installs generate a private sync key on first use and store it in the browser. Use the same key on another browser or device to load the same cloud library. If `VITE_FLASHCARDS_SYNC_KEY` is explicitly set at build time, that configured key is used for new installs that do not already have a saved key.

There are no user accounts or per-user permissions. Anyone with a sync key can access or edit that cloud library, so keep private keys private and rotate to a new key if one is shared accidentally.

### Why new libraries need a generated key

Generated keys are `fc_` followed by 24 random hex characters — 96 bits, which is not guessable. A hand-typed key like `flashcards` or `password` is, and because a write is an in-place upsert with no history, guessing a key means being able to **overwrite a library unrecoverably**, not merely read it.

So creating a library requires a key that came from the generator (the `fc_` prefix plus at least 16 more characters). This gates creation only:

- Reading any well-formed key still works.
- A library that already exists keeps saving under whatever key it has, including keys predating this rule. Nobody is stranded.
- Typing a key that has no library yet is refused with a message pointing at **New key**.

Set `ALLOW_CUSTOM_LIBRARY_IDS=true` on the server if you deliberately want new libraries under hand-picked ids — for example when seeding installs onto a shared `VITE_FLASHCARDS_SYNC_KEY`.

For durable cross-device storage, configure `DATABASE_URL` for the Node server. Without it, the API uses process memory, which works across browsers while the server is running but is lost when the server restarts.

For real deployment, publish the generated `dist/` assets to any static hosting provider.

### Viewing what is stored in the cloud

- **Your own key:** on the home screen, open the `⋯` actions menu → **☁ Sync**. The active key is in the "Sync key" field. It is also in `localStorage` under `flashcards.syncKey.v1`.
- **One library's cards:** `curl -s https://<host>/api/libraries/<syncKey>` returns the full snapshot (sections → decks → cards, plus progress).
- **Every stored key:** set `ADMIN_TOKEN` on the server, then:

  ```bash
  curl -s https://<host>/api/admin/libraries \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  ```

  The response lists each sync key with `updatedAt`, `revision`, and section/deck/card counts, plus deck titles. It deliberately omits card terms and definitions — use the per-library route above to read actual card content. Supports `?limit=` (default 100, max 500). Without `ADMIN_TOKEN` set, the route returns 404.

- **Administration account:** open `/admin` on the deployed app. Sign in with
  `ADMIN_USERNAME` (defaults to `admin`) and `ADMIN_TOKEN` as the password. The
  dashboard shows all stored cloud libraries and supports confirmed permanent
  deletion. Browser sessions use a signed, HttpOnly, SameSite cookie and expire
  after eight hours.

## Card of the Day API

`GET /api/libraries/<syncKey>/daily-card?date=YYYY-MM-DD`

The same card the home screen leads with, resolved server-side and returned on
its own. Main Hub's Daily Dashboard reads this so it can show today's card
without holding the library.

```json
{
  "exists": true,
  "dateKey": "2026-09-10",
  "card": { "id": "…", "term": "…", "definition": "…" },
  "deck": { "id": "…", "title": "emotions1", "subtitle": "" },
  "section": { "id": "…", "title": "GPT" },
  "updatedAt": "…"
}
```

`date` is the **caller's** calendar day and defaults to the server's. A caller in
another timezone must send it, or the card turns over at the wrong hour.

The pick is `pickDailyCard()` — deterministic for the date, and skipping cards
already marked known while any unknown card remains. `server-daily-card.mjs`
restates that rule in plain JS because `server.mjs` runs untranspiled;
`src/lib/__tests__/dailyCard.test.ts` runs both implementations over the same
fixtures so the two cannot drift.

Two things this route deliberately does **not** do:

- It never returns anything but the one card, its deck's title, and its topic's
  title. No other card, no progress, no tombstones, no preferences.
- It never writes. Revealing the answer somewhere else does not mark a card
  known or touch its review schedule.

The sync key is still the credential, exactly as it is for `GET` on the library
itself — anyone holding it can already read everything, so this route grants
nothing new. A library that does not exist answers `200` with
`{"exists": false, "card": null}` rather than confirming or denying a key.

One behaviour to know about if you are comparing the two: the app pins the day's
first pick in `localStorage` and keeps it for the rest of that day, so marking a
card known at 2pm does not change what the app shows. This route recomputes on
every call. They agree on the first computation of a day and can differ after
the library changes within it.

## Sharing a deck

Cloud sync moves a whole library between your own devices. Deck sharing is the
other direction: one deck, handed to someone else.

- **Publish:** open a deck and choose **Share deck**. The deck and its topic's
  name are POSTed to `/api/shared-decks`, which stores a snapshot and returns a
  random `shareId`. The link is copied to your clipboard.
- **Open:** visiting `/d/<shareId>` loads the app and prompts with a preview of
  the deck before anything is written. Declining leaves the library untouched.
- **Accepting** adds the deck as an independent copy. Deck and card ids are
  re-minted against your library, so an incoming deck can never overwrite or
  shadow one you already have — importing the same link twice gives you two
  decks, not a silent merge.

A share is a snapshot, not a subscription: later edits to your copy of the deck
do not change what someone opening an older link sees. Share links carry no
authentication — anyone with the id can read that deck — and there is currently
no way to revoke one, so treat a share link as public. Study progress is never
included.

## Environment Variables

### Server (Node API)

| Variable                   | Required          | Description                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Yes in production | PostgreSQL connection string. Without it the server uses in-memory storage (data lost on restart).                                                                                                                                                                                             |
| `PORT`                     | No                | HTTP port for the Node server (default: `3000`).                                                                                                                                                                                                                                               |
| `ALLOW_MEMORY_STORAGE`     | No                | Set to `true` to allow in-memory fallback even when `NODE_ENV=production`. Useful for local staging runs without a database.                                                                                                                                                                   |
| `ADMIN_TOKEN`              | No                | Strong admin password and bearer token. Enables `/admin`, the library directory API, and confirmed deletion. When unset, all admin API routes return 404.                                                                                                                                      |
| `ADMIN_USERNAME`           | No                | Username for `/admin`. Defaults to `admin`.                                                                                                                                                                                                                                                    |
| `ALLOW_CUSTOM_LIBRARY_IDS` | No                | Set to `true` to let a **new** cloud library be created under any well-formed id instead of only a generated `fc_…` key. Needed when seeding installs onto a hand-picked `VITE_FLASHCARDS_SYNC_KEY`. Leave unset otherwise — it re-opens the guessable-key problem described under Cloud Sync. |

### Client (Vite build-time)

| Variable                   | Required | Description                                                                                                                                                                                                                                   |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FLASHCARDS_SYNC_KEY` | No       | Optional sync key baked into the client bundle for deployments that intentionally start new installs on the same library. When unset, each new browser generates and stores a private sync key. Existing saved valid sync keys are preserved. |

## Deployment Notes

- Build output directory: `dist/`
- App type: static SPA
- Ensure host is configured to serve `index.html` for unknown routes if client-side routing is introduced later.
- Current app has a single route/view and no server-side rendering.

## Folder Structure

```text
.
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ tsconfig.node.json
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ styles.css
   ├─ vite-env.d.ts
   ├─ components/
   │  ├─ HomeView.tsx
   │  ├─ StudyView.tsx
   │  ├─ PinnedView.tsx
   │  ├─ SectionView.tsx
   │  └─ Overlays.tsx
   ├─ hooks/
   │  ├─ useCloudSync.ts
   │  ├─ useStudyKeyboard.ts
   │  └─ useDebouncedPersist.ts
   ├─ lib/
   │  ├─ backup.ts
   │  ├─ constants.ts
   │  ├─ dailyCard.ts
   │  ├─ deckUtils.ts
   │  ├─ format.ts
   │  ├─ merge.ts
   │  ├─ search.ts
   │  ├─ share.ts
   │  ├─ srs.ts
   │  ├─ storage.ts
   │  ├─ sync.ts
   │  ├─ tombstones.ts
   │  └─ types.ts
   └─ data/
      ├─ deckBuilder.ts
      ├─ decks.ts
      ├─ librarySnapshot.ts
      ├─ sharedDeck.ts
      ├─ positiveAdjectives.ts
      ├─ emotions1.ts
      ├─ emotions2.ts
      └─ __tests__/
         ├─ deckBuilder.test.ts
         └─ librarySnapshot.test.ts
```

## Important Files

- `src/main.tsx`: React entry point, mounts `<App />` and imports global styles.
- `src/App.tsx`: Main application UI/state logic (deck browsing, study actions, import flows, keyboard shortcuts, persistence).
- `src/data/deckBuilder.ts`: Core deck/card types and helpers (slug/id generation, import parsing, raw deck conversion).
- `src/data/decks.ts`: Library sections plus default selected deck.
- `src/data/positiveAdjectives.ts` and `src/data/emotions1.ts`: starter deck datasets.
- `src/lib/merge.ts`: the two-device merge — tombstones, last-writer-wins, preferences.
- `src/lib/tombstones.ts`: deletion records, their expiry, and the resurrection rule.
- `src/lib/srs.ts`: the spaced-repetition scheduler and review queue.
- `.github/workflows/ci.yml`: tests, typecheck, lint and build on every pull request.
- `src/lib/backup.ts`: backup file naming, serialisation and reading.
- `src/lib/search.ts`: home search across deck names and card content.
- `src/styles.css`: complete visual design system for the SPA.
- `package.json`: npm scripts and dependency definitions.

## Developer Notes (for future Codex / Claude / OpenClaw agents)

- Treat this as a stateful synced app: the browser keeps a local cache, and cloud state is stored through `/api/libraries/:syncKey`.
- Avoid changing storage key names unless you also provide migration logic.
- When adding import formats, update `splitLine()` in `src/data/deckBuilder.ts` and test invalid-line handling.
- Deck/card IDs are slug-based and deduplicated; preserve `createUniqueId()` semantics to avoid collisions.
- Keep the client snapshot format in `src/data/librarySnapshot.ts` aligned with server validation in `server.mjs`.
- Anything that edits the library must stamp `updatedAt` (see the `touch*` helpers in `src/lib/deckUtils.ts`) and anything that deletes must record a tombstone, or the change will not survive a merge.
- Progress is merged field by field, so a new kind of progress needs its own per-card or per-field stamp. Do not reach for a single whole-object timestamp: that is what made one device's navigation delete another's work.
- Only stamp `positionUpdatedAt` (`updateSelectedDeckProgress(..., { position: true })`) when the user really moved through the deck. Stamping incidental updates makes an idle device look newer than a busy one.
- Session-only state (shuffle order, an active review session) is deliberately not persisted or synced. Keep it that way.
- Keep README and UI copy aligned with actual supported import formats and shortcuts.

## Known Limitations / TODO Signals

- No user accounts are implemented; anyone with the same sync key can access or edit that cloud library.
- Library writes overwrite in place; there is no snapshot history, so a bad or hostile write cannot be rolled back.
- `/api/libraries/:id` is unauthenticated and unthrottled, so keys predating the generated-key rule remain guessable at speed if they are short or memorable.
- Share links cannot be revoked or listed, and shared deck snapshots are never garbage-collected.
- Large starter content is embedded directly in TypeScript source files.
- `index.html` title/description currently emphasize “Positive Adjectives,” while the app now supports a broader multi-section library.
- Known/Remaining and the review schedule are separate systems; a card can be marked known without ever being graded, and vice versa.
- The home page counts cards due later today, but the study queue only offers what is ready now, so the two numbers can differ within a day.
- There is no per-day cap on how many new cards a review session introduces.
- Restoring a backup merges rather than replaces, so it cannot be used to undo an unwanted addition.
- No CSV import/export, no duplicate-term detection on import, and no offline/PWA support.
