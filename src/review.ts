import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "./config";
import { findProfile } from "./profiles";
import { findProvider } from "./providers";
import {
  fetchPrDiff,
  fetchPrMetadata,
  truncateDiff,
  postPrComment,
  checkGhAuth,
  getPrUrl,
} from "./github";
import {
  chatCompletion,
  buildReviewMessages,
  formatReviewComment,
} from "./ai";
import type { Provider, Profile } from "./types";

export async function reviewPr(
  prNumber: number,
  profileName?: string
): Promise<void> {
  // 1. Load & resolve
  const config = loadConfig();

  let profile: Profile;
  if (profileName) {
    profile = findProfile(profileName);
  } else {
    const found = config.profiles.find(
      (p) => p.name.toLowerCase() === config.activeProfile.toLowerCase()
    );
    if (!found) {
      throw new Error(
        `Active profile "${config.activeProfile}" not found. Run "pr-review profile use <name>".`
      );
    }
    profile = found;
  }

  const providers: Provider[] = profile.providers.map((name) =>
    findProvider(name)
  );

  // 2. Check gh auth
  await checkGhAuth();

  // 3. Fetch diff and PR metadata in parallel
  const spinner = ora("Fetching PR diff and metadata...").start();
  let diff: string;
  let truncated = false;
  let metadata: { title: string; body: string } = { title: "", body: "" };
  try {
    const [rawDiff, meta] = await Promise.all([
      fetchPrDiff(prNumber, profile.repoUrl),
      fetchPrMetadata(prNumber, profile.repoUrl),
    ]);
    const result = truncateDiff(rawDiff);
    diff = result.diff;
    truncated = result.truncated;
    metadata = meta;

    const extra = meta.title ? `, ${meta.title.slice(0, 40)}...` : "";
    spinner.succeed(
      `Fetched PR #${prNumber} diff (${result.diff.length.toLocaleString()} chars${truncated ? ", truncated" : ""})${extra}`
    );
  } catch (err: any) {
    spinner.fail(err.message);
    throw err;
  }

  // 4. Review + post: each provider runs its own full pipeline independently
  const total = providers.length;
  const spinner2 = ora(`Asking ${total} reviewer${total > 1 ? "s" : ""}...`).start();

  const messages = buildReviewMessages(profile.systemPrompt, diff, metadata);

  type TaskOutcome =
    | { status: "ok"; provider: string; review: string }
    | { status: "fail"; provider: string; error: string };

  const outcomes: TaskOutcome[] = await Promise.all(
    providers.map(async (provider): Promise<TaskOutcome> => {
      try {
        const content = await chatCompletion(provider, messages);
        const commentBody = formatReviewComment(
          content,
          provider.name,
          provider.model,
          truncated,
        );
        await postPrComment(prNumber, profile.repoUrl, commentBody);
        return { status: "ok", provider: provider.name, review: content };
      } catch (err: any) {
        return { status: "fail", provider: provider.name, error: err.message };
      }
    }),
  );

  const succeeded = outcomes.filter((o) => o.status === "ok");
  const failed = outcomes.filter((o) => o.status === "fail");

  if (failed.length > 0 && succeeded.length > 0) {
    spinner2.warn(
      `${succeeded.length}/${total} reviews posted`
    );
  } else if (failed.length > 0) {
    spinner2.fail(
      `All ${total} reviewer${total > 1 ? "s" : ""} failed`
    );
  } else {
    spinner2.succeed(
      `${succeeded.length} review${succeeded.length > 1 ? "s" : ""} posted to PR #${prNumber}`
    );
  }

  // 5. Summary
  const prUrl = getPrUrl(profile.repoUrl, prNumber);
  console.log();
  if (succeeded.length > 0) {
    console.log(chalk.green(`Posted by: ${succeeded.map((s) => s.provider).join(", ")}`));
  }
  if (failed.length > 0) {
    for (const f of failed) {
      console.log(chalk.red(`  ✘ ${f.provider}: ${f.error}`));
    }
  }
  console.log(chalk.blue(`PR: ${prUrl}`));
}
