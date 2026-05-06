import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Config, ConfigSchema } from "./types";

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, "pr-review");
  return path.join(os.homedir(), ".config", "pr-review");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(
      `No config found at ${configPath}\nRun "pr-review setup" to get started.`
    );
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw);

  // migrate: if providers don't have apiKey, keep them
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Config file is invalid at ${configPath}:\n${result.error.message}\nFix it manually or delete and run "pr-review setup".`
    );
  }
  return result.data;
}

export function saveConfig(config: Config): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function getGithubToken(config: Config): string {
  // profile-level token? no — global, then env fallback
  if (config.githubToken) return config.githubToken;
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (envToken) return envToken;
  throw new Error(
    "No GitHub token found in config or GITHUB_TOKEN/GH_TOKEN environment variable."
  );
}

export function resolveProviderApiKey(provider: { name: string; apiKey?: string }): string {
  if (provider.apiKey) return provider.apiKey;
  const envKey = process.env[`${provider.name.toUpperCase()}_API_KEY`];
  if (envKey) return envKey;
  throw new Error(
    `No API key for provider "${provider.name}". Set it in config or export ${provider.name.toUpperCase()}_API_KEY.`
  );
}
