# pr-review — Agent Guide

**CLI tool** that fetches a GitHub PR diff, sends it to one or more AI providers in parallel, and posts each review as a separate PR comment. No interactive confirmation — reviews are posted directly.

## Essential Commands

| Command | Purpose |
|---------|---------|
| `bun run src/index.ts <pr-num>` | Run (no build step — Bun runs TS directly) |
| `bun install` | Install deps (Bun's lockfile is `bun.lock`, not `package-lock.json`) |
| `bun link` | Make `pr-review` available globally |

No build, test, or lint commands exist in this project — there are no test files, no lint config, and `tsconfig.json` has `noEmit: true`. Changes are verified by running the tool manually.

## Code Organization (9 source files in `src/`)

```
src/
  index.ts    — CLI entry point (commander). Defines all commands and subcommands.
  types.ts    — Zod schemas + TS types for Config, Provider, Profile. Constants.
  config.ts   — Config file read/write at ~/.config/pr-review/config.json. Token/key resolution.
  review.ts   — Main review orchestration (resolve profile → fetch diff → AI → post comments).
  ai.ts       — OpenAI-compatible chat completions API calls. Also ping + comment formatting.
  github.ts   — gh CLI wrapper (spawns `gh` subprocesses). Diff fetch, metadata, commenting.
  setup.ts    — Interactive first-run wizard.
  providers.ts— CRUD for providers in config. Also cleans up profile references on removal.
  profiles.ts — CRUD for profiles in config. Handles active-profile fallback on removal.
  prompt.ts   — readline-based interactive input/confirm helpers.
```

## Architecture & Data Flow

```
pr-review <num>
  → index.ts (parse args, load config or auto-setup)
  → review.ts:
      1. resolve profile (by name or activeProfile in config)
      2. resolve provider(s) from profile's provider name list
      3. check gh auth
      4. fetch diff (gh pr diff) + fetch metadata (gh pr view --json title,body) in parallel
      5. truncate diff if over 150k chars (head/tail with "...[truncated]..." separator)
      6. build ChatMessage[] (system prompt + user message with title/body/diff)
      7. for each provider (Promise.all — parallel):
           a. POST {baseUrl}/v1/chat/completions with the messages
           b. format review comment with header + diff-truncated warning
           c. gh pr comment --body-file <tmpfile> (write to temp, then post)
      8. print summary (success/fail per provider + PR URL)
```

### Key Design Points

- **No bundler needed** — Bun runs `.ts` files directly with `module: "Preserve"` and `verbatimModuleSyntax: true`.
- **Config at `~/.config/pr-review/config.json`** — XDG_CONFIG_HOME aware. JSON file validated with Zod.
- **API keys resolved via env fallback** — `<NAME>_API_KEY` env var checked if not in config. `GITHUB_TOKEN` / `GH_TOKEN` for GitHub.
- **Diff truncation** — `DIFF_MAX_CHARS = 150_000` in `types.ts`. Truncation takes head/tail halves with a marker. Not file-aware — can split in the middle of a hunk.
- **Temp files for gh pr comment** — `github.ts` writes comment body to `/tmp/pr-review-comment-*` then passes `--body-file`. Cleaned up in `finally`-equivalent (not a `finally` block, just an immediate `try delete` — no crash if deletion fails).
- **Parallel everywhere** — diff+metadata fetched in parallel, all providers called in parallel, all `gh pr comment` calls in parallel.
- **Parallelism means no order** — reviews post in arbitrary order. Each AI gets the full diff independently (no sharing/collaboration).
- **No caching** — every run fetches fresh from GitHub and calls all providers.

## Non-obvious Patterns & Gotchas

### gh CLI (GitHub CLI) dependency
- Everything interacts with GitHub via `gh` subprocesses (`Bun.spawn`). The `gh` binary must be installed, authenticated, and on `PATH`.
- `ghEnv()` passes `GH_TOKEN` to the subprocess (from config or env var), so `gh` never needs interactive login.
- `fetchPrMetadata` returns empty strings on failure (non-fatal) — metadata is nice-to-have.
- `fetchPrDiff` throws on empty diff (PR with no changes).

### Config mutations reload every time
- `providers.ts` and `profiles.ts` CRUD functions call `loadConfig()` and `saveConfig()` every time — they always re-read/write the full config file. Never mutate config in-place without calling `saveConfig`.
- Config is the single source of truth with no in-memory cache (except a module-level `_config` cache in `github.ts` that's lazily initialized and never invalidated).

### Active profile lifecycle
- `activeProfile` is a string field in config (the name), not a reference. On profile removal, if the removed profile was active, it auto-selects `config.profiles[0]` — and if no profiles remain, throws.
- Profile/provider matching is **case-insensitive** (`.toLowerCase()` comparisons everywhere), but the stored name preserves the original casing.

### Provider removal cascades
- `removeProvider` also removes the provider name from all profiles' `providers` arrays. No warning — silently drops it.

### No test infrastructure
- Zero tests exist. No test runner, no test files. TypeScript strictness (`strict: true`, `noUncheckedIndexedAccess`) provides the only static guarantees. Changes must be manually verified.

### AI Provider contract
- Assumes **OpenAI-compatible** chat completions API (`POST /v1/chat/completions` with `{ model, messages, temperature, max_tokens }`).
- Response shape: `{ choices: [{ message: { content: string } }] }`.
- Error handling parses `{ error: { message } }` from both non-200 responses and 200 responses with an error field.
- No streaming support — always waits for full response.
- `temperature` defaults to 0.3 for reviews, 0 for pings.
- `max_tokens` defaults to 4096.

### Ping behavior
- `pingProvider` sends `{ role: "user", content: "ping" }` and returns the first ~80 chars of the response (or `reasoning_content` if `content` is empty). Also captures `rawResponse` for `-v` flag.
- Not a true connectivity check (does a full completion) — consumes tokens.

### Import style
- Uses `module: "Preserve"` + `verbatimModuleSyntax: true` — imports that are only types must use `import type`.
- Dynamic imports used in `setup.ts` for `prompt.ts` functions (inside the function body, not top-level).
- `chalk` v5 and `ora` v9 are ESM-only.

### Prompt modul
- `prompt.ts` creates a new readline `Interface` per call, and closes it after each question. This is fine for CLI interaction but means no shared state across prompts.
- `input()` supports an optional `defaultVal` — returns the default if user enters nothing.
- `confirm()` returns boolean for `y`/`yes` (case-insensitive), false for anything else.

### Settings
- `bun link` makes the CLI available globally. `bun unlink` removes it.
- No CI/CD configs, no Docker, no Makefile.
