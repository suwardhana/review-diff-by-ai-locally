import chalk from "chalk";
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
  chatCompletionStream,
  buildReviewMessages,
  formatReviewComment,
} from "./ai";
import type { Provider, Profile } from "./types";

export async function reviewPr(
  prNumber: number,
  profileName?: string,
  timeoutMs?: number,
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

  // 3. Fetch diff and PR metadata
  console.log(chalk.gray("Fetching PR diff and metadata..."));
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
    console.log(
      chalk.green(
        `Fetched PR #${prNumber} diff (${result.diff.length.toLocaleString()} chars${truncated ? ", truncated" : ""})${extra}`
      )
    );
  } catch (err: any) {
    console.error(chalk.red(`\nError: ${err.message}`));
    throw err;
  }

  const messages = buildReviewMessages(profile.systemPrompt, diff, metadata);

  // 4. Review each provider sequentially with streaming output
  const outcomes: Array<
    | { status: "ok"; provider: string; review: string }
    | { status: "fail"; provider: string; error: string }
  > = [];

  for (const provider of providers) {
    const header = `\n${chalk.bold.cyan("──")} ${chalk.bold(provider.name)} ${chalk.gray(`(${provider.model})`)} ${chalk.bold.cyan("──")}`;
    console.log(header);

    let fullReview = "";
    let reasoning = "";

    try {
      const stream = chatCompletionStream(provider, messages, { timeoutMs });

      for await (const event of stream) {
        if (event.reasoning) {
          reasoning += event.reasoning;
          // Print reasoning dimmed — it's the model's thinking
          process.stdout.write(chalk.dim(event.reasoning));
        }
        if (event.content) {
          fullReview += event.content;
          process.stdout.write(event.content);
        }
      }

      // Ensure a trailing newline before the next section
      if (!fullReview.endsWith("\n")) process.stdout.write("\n");

      if (!fullReview.trim()) {
        throw new Error("Received empty review.");
      }

      const commentBody = formatReviewComment(
        fullReview,
        provider.name,
        provider.model,
        truncated,
      );
      await postPrComment(prNumber, profile.repoUrl, commentBody);

      console.log(chalk.green(`✓ Posted to PR #${prNumber}`));
      outcomes.push({ status: "ok", provider: provider.name, review: fullReview });
    } catch (err: any) {
      console.log(chalk.red(`✘ ${err.message}`));
      outcomes.push({ status: "fail", provider: provider.name, error: err.message });
    }
  }

  // 5. Summary
  const succeeded = outcomes.filter((o) => o.status === "ok");
  const failed = outcomes.filter((o) => o.status === "fail");
  const prUrl = getPrUrl(profile.repoUrl, prNumber);

  console.log();
  if (succeeded.length > 0) {
    console.log(
      chalk.green(`${succeeded.length}/${providers.length} reviews posted → ${prUrl}`)
    );
  }
  if (failed.length > 0) {
    for (const f of failed) {
      console.log(chalk.red(`  ✘ ${f.provider}: ${f.error}`));
    }
  }
}
