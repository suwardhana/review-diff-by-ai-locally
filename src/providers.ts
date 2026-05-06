import { loadConfig, saveConfig } from "./config";
import type { Provider } from "./types";
import { ProviderSchema } from "./types";

export function listProviders(): { providers: Provider[]; current?: string } {
  const config = loadConfig();
  return { providers: config.providers, current: undefined };
}

export function addProvider(provider: Provider): void {
  const config = loadConfig();
  const trimmed = { ...provider, apiKey: provider.apiKey?.trim() || undefined };

  const result = ProviderSchema.safeParse(trimmed);
  if (!result.success) {
    throw new Error(`Invalid provider data:\n${result.error.message}`);
  }

  const existing = config.providers.find(
    (p) => p.name.toLowerCase() === trimmed.name.toLowerCase()
  );
  if (existing) {
    throw new Error(
      `Provider "${trimmed.name}" already exists. Remove it first or use a different name.`
    );
  }

  config.providers.push(result.data);
  saveConfig(config);
}

export function removeProvider(name: string): void {
  const config = loadConfig();
  const idx = config.providers.findIndex(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) {
    throw new Error(`Provider "${name}" not found.`);
  }
  const removed = config.providers.splice(idx, 1)[0];

  // remove from all profiles that reference it
  for (const profile of config.profiles) {
    profile.providers = profile.providers.filter(
      (n) => n.toLowerCase() !== removed.name.toLowerCase()
    );
  }

  saveConfig(config);
}

export function findProvider(name: string): Provider {
  const config = loadConfig();
  const provider = config.providers.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (!provider) {
    throw new Error(`Provider "${name}" not found.`);
  }
  return { ...provider };
}

export function getProviderNames(): string[] {
  const config = loadConfig();
  return config.providers.map((p) => p.name);
}
