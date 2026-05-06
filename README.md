# pr-review

Review GitHub PRs locally using AI — fetch the diff, ask your LLMs, post reviews directly to the PR.

## Prerequisites

- **[Bun](https://bun.com)** >= 1.1
- **[GitHub CLI](https://cli.github.com)** (`gh`) installed and authenticated (`gh auth login`)
- One or more OpenAI-compatible AI providers (OpenAI, DeepSeek, Groq, Ollama, etc.)

## Install

```bash
git clone <repo-url>
cd review-diff-by-ai-locally
bun install
bun link
```

`pr-review` is now available globally.

## Quick Start

```bash
pr-review setup
```

This walks you through:
1. GitHub token — `gh` uses its own auth; this is optional (falls back to `GITHUB_TOKEN` env)
2. A **profile** — name, repo (`owner/repo`), and system prompt for the AI reviewer
3. An **AI provider** — name, base URL, model, and API key

After setup, you're ready:

```bash
pr-review 42
```

Fetches PR #42's diff, sends it to your AI provider(s), and posts the reviews as comments.

## Configuration

Config lives at `~/.config/pr-review/config.json`:

```json
{
  "githubToken": "ghp_xxx",
  "activeProfile": "frontend",
  "providers": [
    {
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat",
      "apiKey": "sk-xxx"
    }
  ],
  "profiles": [
    {
      "name": "frontend",
      "repoUrl": "org/web-app",
      "systemPrompt": "You are a senior React/TypeScript reviewer...",
      "providers": ["deepseek"]
    }
  ]
}
```

### Environment variables

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | Fallback if `githubToken` not in config |
| `<NAME>_API_KEY` | Fallback for a provider's API key (e.g. `DEEPSEEK_API_KEY`) |

## Commands

### Main

```bash
pr-review 42               # Review PR #42 using active profile
pr-review 42 -p backend    # Review using a specific profile
```

### Setup & config

```bash
pr-review setup            # Interactive first-run wizard
pr-review config           # Print config (secrets redacted)
```

### Connectivity

```bash
pr-review ping             # Test connection to all providers
pr-review ping -v          # Same, with full raw API response
```

### Providers

```bash
pr-review provider add     # Add an AI provider
pr-review provider list    # List all providers
pr-review provider remove <name>
```

### Profiles

```bash
pr-review profile add      # Add a profile (repo + prompt + providers)
pr-review profile use <name>  # Switch active profile
pr-review profile list     # List profiles (▶ = active)
pr-review profile remove <name>
```

## How it works

```
pr-review 42
  │
  ├─ Resolve profile → repoUrl, systemPrompt, [providers]
  ├─ Check gh auth
  ├─ gh pr diff 42 --repo <repoUrl>
  ├─ For each provider (parallel):
  │    POST {baseUrl}/v1/chat/completions
  │    ├─ system: profile.systemPrompt
  │    └─ user:  Review this PR diff...
  └─ For each review (parallel):
       gh pr comment 42 --repo <repoUrl> --body "**🤖 Review by {name}**\n..."
```

- **One diff, one fetch** — fetched once, sent to all providers
- **N providers, N comments** — each AI posts its own review
- **No confirmation** — reviews are posted directly

## Uninstall

```bash
bun unlink
```
