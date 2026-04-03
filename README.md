# GoalRate Desktop

AI-powered daily planning for solo founders. Built with [Tauri 2](https://tauri.app/), React 19, and Rust.

GoalRate Desktop is an offline-first desktop app that helps founders stay focused on what matters. It combines a local markdown vault with an AI-driven daily loop to plan, prioritize, and reflect on your work.

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
│   └── websocket/         # WebSocket + sync management
└── tooling/               # ESLint, TypeScript, Tailwind configs
```

## Prerequisites

- **Node.js** >= 24 (< 26)
- **pnpm** 8.15+
- **Rust** 1.75+ (with `cargo`)
- **Tauri 2 CLI** (`cargo install tauri-cli`)
- macOS 10.15+ (primary target)

## Getting Started

```bash
# Install dependencies
pnpm install

# Run in development mode (Vite + Tauri)
pnpm run dev

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.0 |
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| Styling | Tailwind CSS 4 |
| Backend | Rust (tokio, serde, rusqlite) |
| Encryption | AES-256-GCM, ChaCha20-Poly1305, X25519 |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Vitest (TS), cargo test (Rust) |

## License

This repository uses a multi-license structure:

- **Desktop app & Rust crates** (`apps/desktop/`, `crates/`) -- GPLv3
- **Shared packages** (`packages/`) -- MIT

See [LICENSE.md](LICENSE.md) for full details.

Copyright (c) 2025-2026 GoalRate Technologies Inc.
