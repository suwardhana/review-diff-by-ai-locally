import { z } from "zod";

export const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export const ProviderSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const ProfileSchema = z.object({
  name: z.string().min(1),
  repoUrl: z.string().min(1),
  systemPrompt: z.string().min(1),
  providers: z.array(z.string()).min(1),
});

export const ConfigSchema = z.object({
  githubToken: z.string().optional(),
  activeProfile: z.string().min(1),
  providers: z.array(ProviderSchema).default([]),
  profiles: z.array(ProfileSchema).default([]),
});

export type Provider = z.infer<typeof ProviderSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export const DIFF_MAX_CHARS = 150_000;

export const DEFAULT_SYSTEM_PROMPT = `You are an expert code reviewer. Review the provided pull request diff thoroughly. Focus on:
- Bugs, logic errors, and edge cases
- Performance issues and inefficiencies
- Security vulnerabilities
- Code style, best practices, and maintainability
- Architecture and design concerns
- Missing or inadequate tests

Format your review in markdown with clear sections. Be constructive and specific—reference line numbers, file paths, and variable names where relevant.`;
