import { saveConfig, configExists, loadConfig } from "./config";
import type { Config } from "./types";
import { DEFAULT_SYSTEM_PROMPT } from "./types";

export async function runSetup(): Promise<void> {
  if (configExists()) {
    const { confirm } = await import("./prompt");
    const answer = await confirm("Config already exists. Overwrite? (y/N)");
    if (!answer) {
      console.log("Setup cancelled. Use subcommands to manage profiles and providers.");
      return;
    }
  }

  const { input, confirm: confirmFn } = await import("./prompt");

  console.log("\n=== pr-review setup ===\n");

  // 1. Github token
  let githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (githubToken) {
    console.log(`GitHub token: ${redact(githubToken)} (from env)`);
  } else {
    githubToken = await input("GitHub token (ghp_...)");
  }

  // 2. First profile
  console.log("\n--- First profile ---");
  const profileName = await input("Profile name (e.g. frontend)", "default");
  const repoUrl = await input("Repository URL (e.g. owner/repo)");
  const systemPrompt = await input(
    `System prompt for AI review (press Enter for default)`
  );

  // 3. First provider
  console.log("\n--- First AI provider ---");
  const providerName = await input("Provider name (e.g. deepseek)");
  const providerBaseUrl = await input(
    "Base URL (e.g. https://api.deepseek.com)"
  );
  const providerModel = await input("Model name (e.g. deepseek-chat)");
  let providerApiKey = "";
  const hasEnvKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
  if (hasEnvKey) {
    console.log(`API key: ${redact(hasEnvKey)} (from ${providerName.toUpperCase()}_API_KEY env)`);
  } else {
    providerApiKey = await input("API key");
  }

  const config: Config = {
    githubToken: githubToken || undefined,
    activeProfile: profileName,
    providers: [
      {
        name: providerName,
        baseUrl: providerBaseUrl,
        model: providerModel,
        apiKey: providerApiKey || undefined,
      },
    ],
    profiles: [
      {
        name: profileName,
        repoUrl,
        systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        providers: [providerName],
      },
    ],
  };

  saveConfig(config);
  console.log(`\nConfig saved. You're ready to go! Run: pr-review <number>`);
}

function redact(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}
