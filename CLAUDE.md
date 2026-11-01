# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Humn is a Tauri v2 desktop lyrics overlay (React 19 + TypeScript frontend, Rust backend). It detects the currently playing track and shows synced lyrics on Windows (SMTC), macOS (MediaRemote private framework) and Linux (MPRIS2 over D-Bus).

## Commands

- `bun install`: install dependencies
- `bun run tauri dev`: run the app (Tauri starts Vite on port 1420 through `beforeDevCommand`)
- `bun run tauri build`: build a release bundle
- `bun run build`: type-check the frontend (`tsc`) and build it with Vite. This is the main frontend check.
- `cargo check` (run in `src-tauri/`): check the Rust code. Platform modules are `#[cfg]`-gated, so this only checks the module for the OS you run it on.

`bun run dev` starts only Vite, not the Tauri window. Tauri APIs (`invoke`, `listen`) fail in a plain browser.

The repo has no test suite and no linter.

Linux builds need these system packages: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev pkg-config`.

## Releases

The version number lives in three files, and all three must match: `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which uses `tauri-action` to build for Windows, macOS and Linux and publish a GitHub release. The release is signed with `TAURI_SIGNING_PRIVATE_KEY`. The in-app updater (`useUpdater.ts`) reads `latest.json` from the latest GitHub release and checks it against the `pubkey` in `tauri.conf.json`. If the signing key changes, that pubkey must change too.

## Architecture

### Now-playing pipeline (Rust → frontend)

- `src-tauri/src/lib.rs` defines `NowPlayingInfo` and `get_info()`, which picks the platform module (`smtc.rs`, `macos.rs` or `linux.rs`) at compile time with `#[cfg(target_os)]`. Each module exposes `get_now_playing() -> Option<NowPlayingInfo>`. A new platform needs a module, a `get_info` arm and target-specific dependencies in `Cargo.toml`.
- A background thread polls `get_info()` every 100 ms. It emits `track-changed` when the title or artist changes (payload `null` when nothing is playing) and `position-tick` on every poll.
- `useNowPlaying.ts` does not render the raw position. It keeps a local clock that free-runs with `performance.now()`, is capped at the track duration, and updates React every 16 ms. The clock resyncs only when the reported position or play state changes. Players such as Spotify update their position about once a second, so resyncing on every tick causes visible jitter (see commit 9be9b47). A position of `<= 0` counts as unreadable, but a play-state change in that case still updates the clock.

### Lyrics pipeline

`useLyrics` → `lib/lyricsApi.ts#fetchLyrics`, which tries these sources in order:

1. **better-lyrics API** (`lib/betterLyricsApi.ts`):
   - `turnstile.ts` gets a JWT. It loads a Cloudflare Turnstile iframe from `lyrics.api.dacubeking.com/challenge`, swaps the token for a JWT through the Rust command `verify_turnstile`, and caches the JWT in `localStorage` (`bl_jwt_v1`).
   - The Rust command `stream_lyrics` (`lyrics.rs`) POSTs to `/v2/lyrics`. If no video ID was passed, it first looks one up through YouTube Music's innertube search. It parses the SSE response and forwards each provider message over a Tauri `Channel` as `LyricsEvent` (`provider` / `done` / `error`).
   - The frontend parses each provider's payload (`processProvider`), scores it with `calcPriority`, and keeps the highest-scoring result. It stops early at priority ≥ 13 (syllable-level), and gives up after 25 s.
2. **LRCLib**, called directly from the frontend: an exact `/get` lookup, then a `/search` fallback that picks the result closest in duration.

All HTTP calls to the better-lyrics API go through Rust to get around CORS in the webview. A new provider needs a branch in `processProvider` and a score in `calcPriority`.

Every parser (`lrcParser.ts`, `ttmlParser.ts`, `qrcParser.ts`) returns `LrcLine[]` (defined in `lrcParser.ts`). `time` is in **seconds**, while `words[].startMs` and `durationMs` are in **milliseconds**. TTML also fills `agent` (v1 = left, v2/v3 = right, v1000 = centered) and `isBackground`, which `LyricLine` uses for layout. `useLyrics` caches results by `title::artist` for the session.

### Window / UI

- The window is frameless, transparent and always on top (`tauri.conf.json`). `App.tsx` draws its own title bar and calls `startDragging()` on mousedown, except when the target is a button.
- "Docked" mode means the window is maximized or wider than 480 logical px. In docked mode the background is opaque and the controls always show. Otherwise the window is a transparent overlay that shows its chrome only on hover.
- The close button hides the window rather than quitting. Quit is in the tray menu (`setup_tray` in `lib.rs`).
- Each new window or plugin API used from the frontend needs its permission added to `src-tauri/capabilities/default.json`.
- UI components come from shadcn/ui (`components.json`, files in `src/components/ui`). Styling uses Tailwind v4 through `@tailwindcss/vite`, with no Tailwind config file.

## Path Aliases

`@/*` → `./src/*` (set in both `tsconfig.json` and `vite.config.ts`).
