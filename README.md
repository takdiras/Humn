# Humn

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/kabutakoo)

A desktop lyrics overlay for Windows. Humn sits on top of your other windows and displays real-time synchronized lyrics for whatever is currently playing — detected automatically via the Windows System Media Transport Controls (SMTC) API.

## Features

- Auto-detects the current track from any SMTC-compatible player (Spotify, Apple Music, YouTube Music, etc.)
- Multi-provider lyrics with priority ranking: Apple Music TTML → BiniLyrics → QQ Music QRC → Musixmatch → LRCLib → KuGou
- Word- and syllable-level sync where available
- Transparent overlay mode (floats above other windows) and docked mode (snapped/maximized)
- System tray integration

## Requirements

- Windows 10/11
- [Rust](https://rustup.rs/) (stable toolchain)
- [Bun](https://bun.sh/)
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2, Visual Studio Build Tools)

## Getting Started

```bash
# Install dependencies
bun install

# Start development server (hot-reload frontend + Tauri window)
bun run tauri dev

# Build a release binary
bun run tauri build
```

## Project Structure

```
src/                        # React + TypeScript frontend
  App.tsx                   # Root component, window management
  hooks/
    useNowPlaying.ts        # SMTC integration via Tauri events
    useLyrics.ts            # Lyrics fetching and sync
  components/
    LyricsView.tsx          # Scrolling lyrics display
    LyricLine.tsx           # Per-line renderer with word timing
    NowPlaying.tsx          # Track info header
  lib/
    betterLyricsApi.ts      # Multi-provider lyrics API client

src-tauri/                  # Rust backend
  src/
    lib.rs                  # App setup, tray, SMTC polling loop
    smtc.rs                 # Windows SMTC session reader
    lyrics.rs               # Lyrics fetch + stream to frontend
  tauri.conf.json           # Window config
  capabilities/default.json # Tauri permission grants
```

## Contributing

Contributions are welcome. Here are some good areas to work on:

- **New lyrics providers** — add a parser in `src/lib/betterLyricsApi.ts` and wire it into the priority list
- **macOS/Linux support** — the SMTC backend is Windows-only; equivalents exist on other platforms (MediaRemote on macOS, MPRIS on Linux)
- **UI improvements** — the frontend is plain React + TailwindCSS, easy to iterate on
- **Performance** — lyrics parsing and scroll animations are areas worth profiling

### Workflow

1. Fork the repository and create a branch from `main`
2. `bun install && bun run tauri dev` to verify your setup
3. Make your changes
4. Open a pull request with a short description of what changed and why

Please keep pull requests focused — one thing per PR makes review faster.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, TailwindCSS v4, Framer Motion |
| Backend | Rust, Tauri v2 |
| Build | Bun, Vite, TypeScript compiler |
| Windows APIs | SMTC (`windows` crate) |

## License

[MIT](LICENSE) © 2026 Takdir Saputro
