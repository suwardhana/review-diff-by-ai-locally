#!/usr/bin/env bun

import { Command } from "commander";
import chalk from "chalk";
import { configExists, loadConfig } from "./config";
import { runSetup } from "./setup";
import { reviewPr } from "./review";
import { addProvider, removeProvider, listProviders } from "./providers";
import {
  addProfile,
  useProfile,
  removeProfile,
  listProfiles,
} from "./profiles";
import { input } from "./prompt";
import { DEFAULT_SYSTEM_PROMPT } from "./types";

const program = new Command();

program
  .name("pr-review")
  .description("Review GitHub PRs locally using AI")
  .version("1.0.0");

// ---- main command: pr-review <number> ----
program
  .argument("[pr-number]", "PR number to review")
  .option("-p, --profile <name>", "use a specific profile instead of active")
  .action(async (prNumber, options) => {
    if (!prNumber) {
      program.outputHelp();
      return;
    }

    const num = parseInt(prNumber, 10);
    if (isNaN(num) || num <= 0) {
      console.error(chalk.red(`Invalid PR number: ${prNumber}`));
      process.exit(1);
    }

    if (!configExists()) {
      console.log(chalk.yellow("No config found. Starting setup..."));
      await runSetup();
    }

    try {
      await reviewPr(num, options.profile);
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
      process.exit(1);
    }
  });

// ---- setup ----
program
  .command("setup")
  .description("Run first-time setup wizard")
  .action(async () => {
    try {
      await runSetup();
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ---- config show ----
program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    ensureConfig();
    const config = loadConfig();
    const redacted = {
      ...config,
      githubToken: config.githubToken ? redact(config.githubToken) : undefined,
      providers: config.providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? redact(p.apiKey) : undefined,
      })),
    };
    console.log(JSON.stringify(redacted, null, 2));
  });

// ---- provider ----
const providerCmd = program
  .command("provider")
  .description("Manage AI providers");

providerCmd
  .command("add")
  .description("Add a new AI provider")
  .action(async () => {
    ensureConfig();
    console.log(chalk.cyan("\nAdd AI provider\n"));
    const name = await input("Name (e.g. deepseek)");
    if (!name) {
      console.log(chalk.yellow("Name is required. Cancelled."));
      return;
    }
    const baseUrl = await input("Base URL (e.g. https://api.deepseek.com)");
    if (!baseUrl) {
      console.log(chalk.yellow("Base URL is required. Cancelled."));
      return;
    }
    const model = await input("Model (e.g. deepseek-chat)");
    if (!model) {
      console.log(chalk.yellow("Model is required. Cancelled."));
      return;
    }
    let apiKey = "";
    const envKey = process.env[`${name.toUpperCase()}_API_KEY`];
    if (envKey) {
      console.log(
        chalk.gray(`API key: ${redact(envKey)} (from ${name.toUpperCase()}_API_KEY env)`)
      );
    } else {
      apiKey = await input("API key (or leave blank to use env var)");
    }

    try {
      addProvider({ name, baseUrl, model, apiKey: apiKey || undefined });
      console.log(chalk.green(`\nProvider "${name}" added.`));
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
    }
  });

providerCmd
  .command("list")
  .description("List all AI providers")
  .action(() => {
    ensureConfig();
    const { providers } = listProviders();
    if (providers.length === 0) {
      console.log(chalk.yellow("No providers configured."));
      return;
    }
    console.log(chalk.cyan("\nAI Providers:\n"));
    for (const p of providers) {
      const keyStatus = p.apiKey
        ? redact(p.apiKey)
        : process.env[`${p.name.toUpperCase()}_API_KEY`]
          ? `${redact(process.env[`${p.name.toUpperCase()}_API_KEY`]!)} (env)`
          : chalk.red("not set");
      console.log(`  ${chalk.bold(p.name)}`);
      console.log(`    URL:   ${p.baseUrl}`);
      console.log(`    Model: ${p.model}`);
      console.log(`    Key:   ${keyStatus}`);
      console.log();
    }
  });

providerCmd
  .command("remove <name>")
  .description("Remove an AI provider")
  .action((name: string) => {
    ensureConfig();
    try {
      removeProvider(name);
      console.log(chalk.green(`Provider "${name}" removed.`));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

// ---- profile ----
const profileCmd = program
  .command("profile")
  .description("Manage review profiles");

profileCmd
  .command("add")
  .description("Add a new profile")
  .action(async () => {
    ensureConfig();
    const config = loadConfig();

    if (config.providers.length === 0) {
      console.log(
        chalk.yellow('No AI providers configured. Add one first with "pr-review provider add".')
      );
      return;
    }

    console.log(chalk.cyan("\nAdd profile\n"));
    const name = await input("Profile name (e.g. frontend)");
    if (!name) {
      console.log(chalk.yellow("Name is required. Cancelled."));
      return;
    }
    const repoUrl = await input("Repository (e.g. owner/repo)");
    if (!repoUrl) {
      console.log(chalk.yellow("Repository is required. Cancelled."));
      return;
    }
    const systemPrompt = await input(
      "System prompt (press Enter for default)"
    );

    console.log(chalk.cyan("\nAvailable providers:"));
    config.providers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.model})`);
    });
    const selectedStr = await input(
      `Select providers (e.g. 1,2 or all)`
    );

    const providerNames: string[] = [];
    if (!selectedStr || selectedStr.toLowerCase() === "all") {
      providerNames.push(...config.providers.map((p) => p.name));
    } else {
      const indices = selectedStr
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < config.providers.length);
      providerNames.push(...indices.map((i) => config.providers[i].name));
    }

    if (providerNames.length === 0) {
      console.log(chalk.yellow("No providers selected. Cancelled."));
      return;
    }

    try {
      addProfile({
        name,
        repoUrl,
        systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
        providers: providerNames,
      });
      console.log(chalk.green(`\nProfile "${name}" added.`));
    } catch (err: any) {
      console.error(chalk.red(`\nError: ${err.message}`));
    }
  });

profileCmd
  .command("use <name>")
  .description("Set active profile")
  .action((name: string) => {
    ensureConfig();
    try {
      useProfile(name);
      console.log(chalk.green(`Active profile set to "${name}".`));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

profileCmd
  .command("list")
  .description("List all profiles")
  .action(() => {
    ensureConfig();
    const { profiles, active } = listProfiles();
    if (profiles.length === 0) {
      console.log(chalk.yellow("No profiles configured."));
      return;
    }
    console.log(chalk.cyan("\nProfiles:\n"));
    for (const p of profiles) {
      const isActive = active && p.name.toLowerCase() === active.toLowerCase();
      const prefix = isActive ? chalk.green("▶") : " ";
      console.log(`  ${prefix} ${chalk.bold(p.name)}`);
      console.log(`    Repo:         ${p.repoUrl}`);
      console.log(
        `    Providers:    ${p.providers.join(", ")}`
      );
      console.log(
        `    System prompt: ${truncateStr(p.systemPrompt, 60)}`
      );
      console.log();
    }
  });

profileCmd
  .command("remove <name>")
  .description("Remove a profile")
  .action((name: string) => {
    ensureConfig();
    try {
      removeProfile(name);
      console.log(chalk.green(`Profile "${name}" removed.`));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

// ---- helpers ----

function ensureConfig(): void {
  if (!configExists()) {
    console.error(
      chalk.red('No config found. Run "pr-review setup" first.')
    );
    process.exit(1);
  }
}

function redact(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

function truncateStr(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

program.parse();
