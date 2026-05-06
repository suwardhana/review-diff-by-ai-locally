import { loadConfig, saveConfig } from "./config";
import type { Profile } from "./types";
import { ProfileSchema } from "./types";

export function listProfiles(): { profiles: Profile[]; active?: string } {
  const config = loadConfig();
  return { profiles: config.profiles, active: config.activeProfile };
}

export function addProfile(profile: Profile): void {
  const config = loadConfig();
  const result = ProfileSchema.safeParse(profile);
  if (!result.success) {
    throw new Error(`Invalid profile data:\n${result.error.message}`);
  }

  const existing = config.profiles.find(
    (p) => p.name.toLowerCase() === profile.name.toLowerCase()
  );
  if (existing) {
    throw new Error(
      `Profile "${profile.name}" already exists. Remove it first or use a different name.`
    );
  }

  // validate all referenced providers exist
  const providerNames = config.providers.map((p) => p.name.toLowerCase());
  for (const providerName of result.data.providers) {
    if (!providerNames.includes(providerName.toLowerCase())) {
      throw new Error(
        `Provider "${providerName}" not found. Add it first with "pr-review provider add".`
      );
    }
  }

  config.profiles.push(result.data);
  saveConfig(config);
}

export function useProfile(name: string): void {
  const config = loadConfig();
  const profile = config.profiles.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (!profile) {
    throw new Error(`Profile "${name}" not found.`);
  }
  config.activeProfile = profile.name;
  saveConfig(config);
}

export function removeProfile(name: string): void {
  const config = loadConfig();
  const idx = config.profiles.findIndex(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) {
    throw new Error(`Profile "${name}" not found.`);
  }
  const removed = config.profiles.splice(idx, 1)[0];

  // if the active profile was removed, pick a new one
  if (config.activeProfile.toLowerCase() === removed.name.toLowerCase()) {
    config.activeProfile = config.profiles[0]?.name ?? "";
  }

  saveConfig(config);
  if (!config.activeProfile) {
    throw new Error(
      "No profiles remaining. Add a profile with \"pr-review profile add\"."
    );
  }
}

export function getActiveProfile(): Profile {
  const config = loadConfig();
  const profile = config.profiles.find(
    (p) => p.name.toLowerCase() === config.activeProfile.toLowerCase()
  );
  if (!profile) {
    throw new Error(
      `Active profile "${config.activeProfile}" not found. Switch with "pr-review profile use <name>".`
    );
  }
  return { ...profile };
}

export function findProfile(name: string): Profile {
  const config = loadConfig();
  const profile = config.profiles.find(
    (p) => p.name.toLowerCase() === name.toLowerCase()
  );
  if (!profile) {
    throw new Error(`Profile "${name}" not found.`);
  }
  return { ...profile };
}
