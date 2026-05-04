# Repo Rules

## Core Philosophy

- Prefer clarity over cleverness.
- Favor explicitness over abstraction.
- Optimize for long-term maintainability.
- Favor standards-based, future-proof choices over short-lived trends.
- Ship small, testable increments.
- Be pragmatic and friendly.
- Explain local conventions when they are not obvious yet.

## Architecture

- The desktop frontend lives in `apps/desktop/src` and uses React + TypeScript.
- The Tauri backend lives in `apps/desktop/src-tauri` and is the boundary for filesystem, OS, and desktop integrations.
- Shared TypeScript business logic belongs in `packages/` when it should be reused across app surfaces.
- Reusable Rust domain and infrastructure logic belongs in `crates/`, not directly in the Tauri app when it can be shared cleanly.
- Keep UI components focused on presentation, orchestration, and user interaction.
- Avoid mixing UI concerns with backend or persistence logic.
- Prefer pushing domain logic into hooks, libs, packages, or crates instead of large component bodies.

## Naming Conventions

- React components: `PascalCase.tsx`.
- Hooks: `useCamelCase.ts`.
- General utilities and helpers: `camelCase.ts`.
- Rust modules and files: `snake_case`.
- Tauri commands: `snake_case`.
- Types, interfaces, and enums: `PascalCase`.
- Shared constants: `UPPER_SNAKE_CASE` only when they are true constants shared across a boundary.

## State Management

- Keep client state minimal and as local as practical.
- Prefer derived state over duplicated or mirrored state.
- Isolate data loading, persistence, and refresh logic from presentational components.
- Prefer predictable immutable updates.
- Use context or shared state only when state truly spans multiple areas of the app.

## Data and Filesystem

- The vault is the source of truth for user-authored content.
- User content should not be written outside the intended vault root.
- App-managed metadata and integration state should stay inside approved app storage boundaries.
- File operations should be explicit and reversible when possible.
- Prefer structured frontmatter and typed schemas for markdown metadata.
- Keep parsing, indexing, and storage rules in shared packages or crates rather than ad hoc UI code.

## UI and UX

- Prefer keyboard-friendly interactions where they materially improve speed or fluency.
- Avoid modal overload; use dialogs when focus, confirmation, or blocking input really matters.
- Always provide meaningful empty, loading, and error states.
- Keep layouts and interaction patterns consistent across panels, sidebars, and dialogs.
- Preserve continuity between the React UI and Tauri-backed workflows.

## Styling

- Prefer Tailwind-based styling and existing shared UI primitives.
- Reuse tokens and patterns from `@goalrate-app/ui` and `@goalrate-app/tailwind-config` before inventing new ones.
- Avoid one-off CSS and inline styles unless they are clearly justified by computed values or library integration needs.
- Match the established visual language before introducing a new pattern.

## Specs

- Living product specs and PRD-style markdown files live in `specs/`.
- Check `specs/` before making meaningful product or behavior changes.
- If a change introduces a new feature, workflow, or user-facing behavior and no relevant spec exists, add one unless the user asks not to.
- When behavior changes materially, update the relevant spec in the same work when practical.
- Use descriptive kebab-case filenames such as `daily-planning-flow.md`.
- Keep specs focused and practical with sections like `Problem`, `Goals`, `Non-Goals`, `User Experience`, `Requirements`, and `Open Questions`.
- If code and specs disagree, call it out clearly instead of guessing.

## Testing and Quality

- Add or update tests when behavior changes.
- Prefer unit tests for isolated logic and integration tests for multi-step workflows or boundary crossings.
- Run `pnpm run lint`, `pnpm run typecheck`, and relevant tests before shipping.
- Run `cargo check` for Rust-affecting changes, and use `pnpm run rust:clippy` when touching Rust code substantially.
- When changing shared contracts, schemas, or cross-boundary types, update both sides and their tests.

## Common Workflows

- Install dependencies from the repo root: `pnpm install`
- Start the desktop app in development: `pnpm run dev`
- Build the desktop app from the repo root: `pnpm run build`
- Run workspace tests: `pnpm run test`
- Run workspace quality checks: `pnpm run lint`, `pnpm run typecheck`
- Run Rust tests: `pnpm run rust:test`
- Run Rust quality checks: `cargo check`, `pnpm run rust:clippy`, `pnpm run rust:fmt`, `pnpm run rust:fmt:check`
- Work on the desktop package directly: `pnpm --filter @goalrate-app/desktop run dev`, `pnpm --filter @goalrate-app/desktop run tauri:dev`, `pnpm --filter @goalrate-app/desktop run tauri:build`
- Run desktop package checks directly: `pnpm --filter @goalrate-app/desktop run test`, `pnpm --filter @goalrate-app/desktop run test:integration`, `pnpm --filter @goalrate-app/desktop run lint`, `pnpm --filter @goalrate-app/desktop run typecheck`
- Clean the workspace: `pnpm run clean`

## What Not to Do

- Do not introduce a new pattern without explaining why it is needed.
- Do not refactor unrelated code while addressing a focused task.
- Do not guess APIs, contracts, or command behavior when existing code can be read first.
- Do not bypass Tauri command boundaries for filesystem or OS access.
- Do not hardcode secrets, credentials, or user-specific absolute paths.

## How to Work in This Codebase

- Start with the smallest change that proves the intent.
- Read nearby files and existing patterns before adding new code.
- Keep changes scoped and easy to review.
- Update tests and docs alongside behavior changes.
- Leave the code clearer than you found it.

## Cleanup Mode

- Remove dead code, stale imports, unused files, and obsolete configuration when you touch an area deeply enough to do so safely.
- Update tests and docs to match removals.
- Prefer deleting over commenting out.
