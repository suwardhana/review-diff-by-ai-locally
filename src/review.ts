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
  chatCompletion,
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
      let premature = false;

      const stream = chatCompletionStream(provider, messages, { timeoutMs });

      for await (const event of stream) {
        if (event.done) {
          premature = event.premature === true;
          break;
        }
        if (event.reasoning) {
          reasoning += event.reasoning;
          process.stdout.write(chalk.dim(event.reasoning));
        }
        if (event.content) {
          fullReview += event.content;
          process.stdout.write(event.content);
        }
      }

      if (!fullReview.endsWith("\n")) process.stdout.write("\n");

      // If stream ended prematurely and we have no content, retry with non-streaming
      if (premature && !fullReview.trim()) {
        const reasonChars = reasoning.length.toLocaleString();
        console.log(
          chalk.yellow(
            `⚠ Connection dropped after ${reasonChars} chars of reasoning, no content. Retrying with non-streaming request...`
          )
        );
        try {
          fullReview = await chatCompletion(provider, messages, {
            timeoutMs,
            maxTokens: 32768, // higher ceiling for retry — reasoning tokens may have eaten the first attempt
          });
          process.stdout.write(fullReview);
          if (!fullReview.endsWith("\n")) process.stdout.write("\n");
          premature = false;
        } catch (retryErr: any) {
          console.log(chalk.yellow(`⚠ Retry also failed: ${retryErr.message}`));
          // Fall through — reasoning will be used as fallback below
        }
      }

      if (!fullReview.trim()) {
        if (reasoning.length > 0) {
          // Post the reasoning as a partial review — it often contains the analysis
          fullReview =
            `> ⚠️ **Partial review** — the model's final output was not received, but its reasoning/thinking was captured:\n\n` +
            reasoning;
          console.log(
            chalk.yellow(
              `⚠ Posting reasoning as partial review (${reasoning.length.toLocaleString()} chars)`
            )
          );
        } else {
          throw new Error("AI returned an empty review.");
        }
      }

      const commentBody = formatReviewComment(
        fullReview,
        provider.name,
        provider.model,
        truncated,
      );
      await postPrComment(prNumber, profile.repoUrl, commentBody);

      console.log(
        chalk.green(`✓ Posted to PR #${prNumber}${premature ? " (partial review)" : ""}`)
      );
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
