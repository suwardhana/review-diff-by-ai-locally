import { loadConfig, getGithubToken } from "./config";
import type { Config } from "./types";
import { DIFF_MAX_CHARS } from "./types";

let _config: Config | null = null;

function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}

function ghEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const token = getGithubToken(getConfig());
    if (token) env.GH_TOKEN = token;
  } catch {}
  return env;
}

async function ghSpawn(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...ghEnv() },
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

// ============ PR diff ============

export async function fetchPrDiff(
  prNumber: number,
  repoUrl: string
): Promise<string> {
  const { exitCode, stdout, stderr } = await ghSpawn([
    "pr", "diff", String(prNumber), "--repo", repoUrl,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Failed to fetch PR #${prNumber} diff from ${repoUrl}:\n${stderr.trim() || "Unknown error"}`
    );
  }

  if (!stdout.trim()) {
    throw new Error(`PR #${prNumber} has no diff (empty).`);
  }

  return stdout;
}

export function truncateDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= DIFF_MAX_CHARS) {
    return { diff, truncated: false };
  }

  const half = Math.floor(DIFF_MAX_CHARS / 2);
  const head = diff.slice(0, half);
  const tail = diff.slice(diff.length - half);
  const separator =
    "\n\n... [diff truncated — too large for review] ...\n\n";

  return { diff: head + separator + tail, truncated: true };
}

// ============ PR comment ============

export async function postPrComment(
  prNumber: number,
  repoUrl: string,
  body: string
): Promise<string> {
  const tmpFile = `/tmp/pr-review-comment-${prNumber}-${Date.now()}.md`;
  await Bun.write(tmpFile, body);

  const { exitCode, stderr } = await ghSpawn([
    "pr", "comment", String(prNumber), "--repo", repoUrl, "--body-file", tmpFile,
  ]);

  try { await Bun.file(tmpFile).delete(); } catch {}

  if (exitCode !== 0) {
    throw new Error(
      `Failed to comment on PR #${prNumber}:\n${stderr.trim() || "Unknown error"}`
    );
  }

  return `https://github.com/${repoUrl}/pull/${prNumber}`;
}

// ============ auth check ============

export async function checkGhAuth(): Promise<void> {
  const { exitCode } = await ghSpawn(["auth", "status"]);

  if (exitCode !== 0) {
    throw new Error(
      "GitHub CLI (gh) is not authenticated.\nRun: gh auth login"
    );
  }
}

export function getPrUrl(repoUrl: string, prNumber: number): string {
  return `https://github.com/${repoUrl}/pull/${prNumber}`;
}
