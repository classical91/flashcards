# Flashcards Library (React + Vite)

## Overview
Flashcards Library is a single-page React application for studying vocabulary decks in a card-flip workflow. The app ships with starter decks, lets you create additional decks under predefined source sections, supports bulk card import from pasted text (including Quizlet-style tab-separated rows), and persists both your library and study progress in browser `localStorage`.

## Project Type
This repository is a **frontend-only web app** (no backend/API server) built with Vite, React, and TypeScript.

## Current Features (verified from code)
- Browse decks grouped into three library sections: **GPT**, **Wikipedia**, and **Oxford Dictionaries**.
- Study cards with a two-sided flashcard UI (term/definition) and flip interactions.
- Navigate cards with buttons and keyboard shortcuts:
  - `Space` / `Enter`: flip card
  - `Left` / `Right`: previous/next card
  - `K`: mark/unmark current card as known
  - `S`: shuffle current deck
- Track progress per deck:
  - known card count
  - remaining card count
  - progress meter
  - optional “Only remaining” study mode
- Create new decks inside any section.
- Bulk import cards when creating a deck or appending to an existing one.
- Parse pasted lines in multiple formats:
  - `term<TAB>definition` (Quizlet-style)
  - `term - definition` (supports spaced hyphen/en dash/em dash)
  - `term: definition`
  - `term-definition`
- Persist state in browser storage:
  - library/deck content
  - per-deck study progress
  - selected deck
- Includes starter deck data in `src/data`:
  - `Positive Adjectives`
  - `emotions1`

## Tech Stack
- **Runtime/UI:** React 18
- **Language:** TypeScript
- **Bundler/Dev server:** Vite 5
- **React integration:** `@vitejs/plugin-react`
- **Styling:** Plain CSS (`src/styles.css`)
- **Persistence:** Browser `localStorage` (no external DB)

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
This project does not define a custom Node production server. To run the built app locally in production mode:

```bash
npm run preview
```

For real deployment, publish the generated `dist/` assets to any static hosting provider.

## Environment Variables
No environment variables are currently required by the codebase.

If future client-side config is added, Vite variables should use the `VITE_` prefix, for example:

- `VITE_APP_TITLE`
- `VITE_API_BASE_URL`

(These are placeholders only; they are not used today.)

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
   └─ data/
      ├─ deckBuilder.ts
      ├─ decks.ts
      ├─ positiveAdjectives.ts
      └─ emotions1.ts
```

## Important Files
- `src/main.tsx`: React entry point, mounts `<App />` and imports global styles.
- `src/App.tsx`: Main application UI/state logic (deck browsing, study actions, import flows, keyboard shortcuts, persistence).
- `src/data/deckBuilder.ts`: Core deck/card types and helpers (slug/id generation, import parsing, raw deck conversion).
- `src/data/decks.ts`: Library sections plus default selected deck.
- `src/data/positiveAdjectives.ts` and `src/data/emotions1.ts`: starter deck datasets.
- `src/styles.css`: complete visual design system for the SPA.
- `package.json`: npm scripts and dependency definitions.

## Developer Notes (for future Codex / Claude / OpenClaw agents)
- Treat this as a stateful client app: data is persisted to `localStorage` keys in `App.tsx`.
- Avoid changing storage key names unless you also provide migration logic.
- When adding import formats, update `splitLine()` in `src/data/deckBuilder.ts` and test invalid-line handling.
- Deck/card IDs are slug-based and deduplicated; preserve `createUniqueId()` semantics to avoid collisions.
- There is no backend contract to update; any new persistence or sync feature requires architectural changes.
- Keep README and UI copy aligned with actual supported import formats and shortcuts.

## Known Limitations / TODO Signals
- No automated test suite is configured in npm scripts.
- No lint/format scripts are configured.
- Data persistence is local-browser only (no user accounts, no cross-device sync, no export/import file flow).
- Large starter content is embedded directly in TypeScript source files.
- `index.html` title/description currently emphasize “Positive Adjectives,” while the app now supports a broader multi-section library.
