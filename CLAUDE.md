# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Humn is a Tauri-based desktop lyrics overlay application built with React + TypeScript frontend and Rust backend. It displays synchronized lyrics for currently playing music on Windows using the System Media Transport Controls (SMTC) API.

## Development Commands

- `bun run dev` - Start development server (runs both Vite and Tauri dev mode)
- `bun run build` - Build for production (runs TypeScript check + Vite build)
- `bun run preview` - Preview production build
- `bun run tauri` - Run Tauri CLI commands

For Tauri-specific commands:
- `bun run tauri dev` - Start Tauri development mode
- `bun run tauri build` - Build production app bundle

## Architecture

### Frontend (React + TypeScript)
- **App.tsx**: Main application component with window management, drag handling, and responsive UI states
- **Hooks**:
  - `useNowPlaying`: Manages currently playing track info via Tauri events from SMTC
  - `useLyrics`: Fetches and synchronizes lyrics from multiple providers
- **Components**:
  - `NowPlaying`: Displays current track info
  - `LyricsView`: Renders synchronized lyrics with scrolling and highlighting
  - `LyricLine`: Individual lyric line with word-level timing support

### Backend (Rust/Tauri)
- **lib.rs**: Main Tauri app setup with system tray, SMTC polling, and command handlers
- **smtc.rs**: Windows SMTC integration for detecting currently playing music
- **lyrics.rs**: Lyrics fetching from multiple providers (better-lyrics API)

### Lyrics System
The app fetches lyrics from multiple providers with priority ranking:
1. Apple Music TTML (syllable-level) - highest priority
2. BiniLyrics TTML (syllable/line-level)
3. QQ Music QRC (word-level)
4. Musixmatch (word/line-level)
5. LRCLib (synced/plain)
6. KuGou (synced)

Lyrics are parsed from various formats (LRC, TTML, QRC) and displayed with real-time synchronization.

### UI/UX Architecture
- **Responsive modes**:
  - Overlay mode (transparent, minimal) for floating on desktop
  - Docked mode (opaque, full controls) when maximized or snapped
- **Window management**: Custom title bar with minimize/maximize/close controls
- **System integration**: System tray with show/hide/quit menu

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4, Framer Motion, shadcn/ui
- **Backend**: Rust, Tauri v2, Windows APIs
- **Build**: Bun (package manager), TypeScript compiler
- **Styling**: TailwindCSS with custom utility classes, Geist font

## Key Files

- `src/App.tsx` - Main React component
- `src/hooks/useNowPlaying.ts` - SMTC integration
- `src/hooks/useLyrics.ts` - Lyrics fetching and synchronization
- `src/lib/betterLyricsApi.ts` - Multi-provider lyrics API client
- `src-tauri/src/lib.rs` - Tauri app setup and tray
- `src-tauri/src/smtc.rs` - Windows media session detection
- `vite.config.ts` - Vite configuration with Tauri integration

## Path Aliases

- `@/*` resolves to `./src/*` (configured in both tsconfig.json and vite.config.ts)