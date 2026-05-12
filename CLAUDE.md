# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential commands

```bash
bun run src/index.ts 42        # Run directly (no build step — Bun runs TS)
bun link                       # Make pr-review available globally
pr-review setup                # Interactive first-run wizard
pr-review ping -v              # Test all AI providers with verbose output
npx --package=typescript tsc --noEmit  # Type-check
```

No build, test, or lint commands exist. Changes are verified by running the tool manually.

## Architecture

**CLI tool** that fetches a GitHub PR diff, sends it to AI providers via OpenAI-compatible APIs, and posts reviews as PR comments. No interactive confirmation.

```
pr-review <num>
  → index.ts (commander CLI, all commands/subcommands)
  → review.ts:
      1. Resolve profile → repoUrl, systemPrompt, [provider names]
      2. Resolve provider(s) from names
      3. Fetch diff (gh pr diff) + metadata (gh pr view) in parallel
      4. Truncate diff if >150k chars (DIFF_MAX_CHARS in types.ts)
      5. For each provider **sequentially** (streaming):
           a. Call chatCompletionStream → SSE stream, print live
           b. Accumulate full response
           c. Post as PR comment via gh pr comment --body-file <tmp>
      6. Print summary
```

## Key files (9 source files in `src/`)

| File | Role |
|------|------|
| `index.ts` | CLI entry point (commander) — all commands/subcommands |
| `types.ts` | Zod schemas for Config/Provider/Profile, constants |
| `config.ts` | Config file R/W at `~/.config/pr-review/config.json`, token/key resolution |
| `review.ts` | Main orchestration — fetch → AI → post |
| `ai.ts` | OpenAI-compatible API: `chatCompletion`, `chatCompletionStream` (SSE), `pingProvider`, `formatReviewComment` |
| `github.ts` | `gh` CLI wrapper via `Bun.spawn` subprocesses |
| `setup.ts` | Interactive first-run wizard |
| `providers.ts` | CRUD for providers in config |
| `profiles.ts` | CRUD for profiles, active-profile management |
| `prompt.ts` | readline-based input/confirm helpers |

## Non-obvious details

### Streaming & timeout
- Reviews run **sequentially** via `chatCompletionStream` — an async generator that parses SSE chunks and yields `{ content?, reasoning?, done, premature? }`.
- Live output: `reasoning_content` prints dimmed, regular `content` prints normally.
- If the stream ends without the `[DONE]` sentinel (`premature: true`) and no content was received, it **retries once** with the non-streaming `chatCompletion` API (which doesn't drop connections during thinking).
- Every `fetch()` uses `AbortSignal.timeout(timeoutMs)` — resolved as: CLI `--timeout` flag → per-provider `timeoutMs` config → `DEFAULT_TIMEOUT_MS` (300s).
- `--timeout` CLI flag accepts milliseconds.

### gh CLI dependency
- Everything hits GitHub via `gh` subprocesses (`Bun.spawn`). `gh` must be installed, auth'd, and on PATH.
- `ghEnv()` injects `GH_TOKEN` from config/env so `gh` never needs interactive login.
- `fetchPrMetadata` returns empty strings on failure (non-fatal). `fetchPrDiff` throws on empty diff.
- Comments posted via temp files (`/tmp/pr-review-comment-*`) using `--body-file`.

### Config & state
- Config at `~/.config/pr-review/config.json` (XDG_CONFIG_HOME aware). Zod-validated on every load.
- API keys: config value → `<NAME>_API_KEY` env var. GitHub token: config → `GITHUB_TOKEN` / `GH_TOKEN` env.
- CRUD functions call `loadConfig()`/`saveConfig()` every time — always re-read before mutating.
- Profile/provider matching is **case-insensitive** (`.toLowerCase()` everywhere).
- `removeProvider` silently drops the provider from all profiles that reference it.

### AI provider contract
- Assumes OpenAI-compatible `POST /v1/chat/completions`.
- For streaming: `stream: true` + SSE parsing. Response shape: `data: {"choices":[{"delta":{"content":"...","reasoning_content":"..."}}]}\n\n`.
- `temperature` defaults to 0.3 (review) and 0 (ping). `max_tokens` defaults to 4096.
- `pingProvider` sends `{ role: "user", content: "ping" }` — consumes real tokens.
- No caching — every run fetches fresh from GitHub and calls all providers.

### TypeScript config
- `module: "Preserve"` + `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `strict: true` + `noUncheckedIndexedAccess: true`. `noEmit: true`.
- `chalk` v5 and `ora` v9 are ESM-only.
