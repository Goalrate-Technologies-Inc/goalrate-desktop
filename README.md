# GoalRate Desktop

AI-powered daily planning for focused work. Built with [Tauri 2](https://tauri.app/), React 19, and Rust.

GoalRate Desktop is an offline-first desktop app that helps people stay focused on what matters. It combines a local markdown vault with an AI-driven daily loop to plan, prioritize, and reflect on your work.

## Architecture

```
goalrate-desktop/
├── apps/desktop/          # Tauri app (React frontend + Rust backend)
│   ├── src/               # React UI (TypeScript)
│   └── src-tauri/         # Tauri/Rust backend (IPC commands)
├── crates/                # Rust crates
│   ├── vault-core/        # Local vault file operations
│   ├── daily-loop/        # AI daily planning engine
│   ├── focus-engine/      # Focus prioritization & scoring
│   ├── markdown-parser/   # Markdown + YAML frontmatter parser
│   ├── sqlite-index/      # SQLite search index
│   └── crypto/            # AES, ChaCha20, X25519 encryption
├── packages/              # Shared TypeScript packages
│   ├── shared/            # Types, Zod schemas, constants
│   ├── core/              # Platform-agnostic business logic
│   ├── ui/                # React component library
│   ├── storage/           # Storage adapter pattern
│   ├── api-client/        # HTTP/WebSocket client
│   ├── crypto/            # TypeScript encryption utilities
│   └── websocket/         # WebSocket transport utilities
└── tooling/               # ESLint, TypeScript, Tailwind configs
```

## Install

### Homebrew (macOS)

```bash
brew install --cask goalrate
```

### Direct Mac Download

Download the latest macOS installer from the [GoalRate download page](https://goalrate.com/download).

Public Mac releases are Developer ID-signed, built with the hardened runtime, notarized by Apple, and stapled when practical. The download page is the user-facing source for release notes, install and update guidance, and links to the [Privacy Policy](https://goalrate.com/privacy), [Terms of Use](https://goalrate.com/terms), and [Support](https://goalrate.com/support).

| Platform | File |
|----------|------|
| macOS (Universal) | `.dmg` |

## Prerequisites

- **Node.js** >= 24 (< 26)
- **pnpm** 8.15.0 (Corepack can provision the pinned version from `packageManager`)
- **Rust** 1.75+ (with `cargo`)
- **Xcode Command Line Tools** on macOS if native builds fail (`xcode-select --install`)
- macOS 10.15+ (primary target)

The Tauri CLI is installed locally through this workspace; do not install a separate global `tauri-cli`.
If `pnpm` is not available after installing Node.js, run `corepack enable` once.

## Getting Started

```bash
# Install dependencies and launch the desktop app (Vite + Tauri)
pnpm start

# Run Rust tests
pnpm run rust:test

# Run TypeScript tests
pnpm run test

# Lint and typecheck
pnpm run lint
pnpm run typecheck
```

## Building

```bash
# Build the desktop app (release)
pnpm run build

# Build Rust crates only
pnpm run rust:build:release

# Check Rust code with clippy
pnpm run rust:clippy

# Format Rust code
pnpm run rust:fmt
```

Public Mac release artifacts require Apple Developer ID signing, hardened runtime, notarization, and stapling; see [Apple Platform Distribution](specs/apple-platform-distribution.md). Local builds may be unsigned or unstapled unless release credentials are present.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.0 |
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| Styling | Tailwind CSS 4 |
| Backend | Rust (tokio, serde, rusqlite) |
| Testing | Vitest (TS), cargo test (Rust) |

## License

Business Source License 1.1 (`BUSL-1.1`) -- source-visible and free for individual local desktop use. Paid hosted features, OEM, and other production uses beyond the Additional Use Grant require a separate commercial license. See [LICENSE.md](LICENSE.md) for details.

Copyright (c) 2025-2026 GoalRate Technologies Inc.
