import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "./config";
import { findProfile } from "./profiles";
import { findProvider } from "./providers";
import {
  fetchPrDiff,
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

  // 3. Fetch diff
  const spinner = ora("Fetching PR diff...").start();
  let diff: string;
  let truncated = false;
  try {
    diff = await fetchPrDiff(prNumber, profile.repoUrl);
    const result = truncateDiff(diff);
    diff = result.diff;
    truncated = result.truncated;
    spinner.succeed(
      `Fetched PR #${prNumber} diff (${result.diff.length.toLocaleString()} chars${truncated ? ", truncated" : ""})`
    );
  } catch (err: any) {
    spinner.fail(err.message);
    throw err;
  }

  // 4. Parallel AI reviews
  const spinner2 = ora(
    `Asking ${providers.length} reviewer${providers.length > 1 ? "s" : ""}...`
  ).start();

  const messages = buildReviewMessages(profile.systemPrompt, diff);

  type ReviewResult = {
    provider: Provider;
    content: string;
  };

  let reviews: ReviewResult[];
  try {
    reviews = await Promise.all(
      providers.map(async (provider) => {
        const content = await chatCompletion(provider, messages);
        return { provider, content };
      })
    );
    spinner2.succeed(
      `Received ${reviews.length} review${reviews.length > 1 ? "s" : ""}`
    );
  } catch (err: any) {
    spinner2.fail(err.message);
    throw err;
  }

  // 5. Post comments in parallel
  const spinner3 = ora("Posting reviews to PR...").start();

  const commentResults = await Promise.allSettled(
    reviews.map(async (review) => {
      const commentBody = formatReviewComment(
        review.content,
        review.provider.name,
        review.provider.model,
        truncated
      );
      return postPrComment(prNumber, profile.repoUrl, commentBody).then(
        () => review.provider.name
      );
    })
  );

  const succeeded: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < commentResults.length; i++) {
    const result = commentResults[i];
    if (result.status === "fulfilled") {
      succeeded.push(result.value);
    } else {
      failed.push(`${providers[i].name}: ${result.reason?.message || "Unknown error"}`);
    }
  }

  if (failed.length > 0) {
    spinner3.warn(
      `${succeeded.length}/${reviews.length} comments posted`
    );
  } else {
    spinner3.succeed(
      `${succeeded.length} review${succeeded.length > 1 ? "s" : ""} posted to PR #${prNumber}`
    );
  }

  // 6. Summary
  const prUrl = getPrUrl(profile.repoUrl, prNumber);
  console.log();
  if (succeeded.length > 0) {
    console.log(chalk.green(`Posted by: ${succeeded.join(", ")}`));
  }
  if (failed.length > 0) {
    console.log(chalk.red(`Failed: ${failed.join(", ")}`));
  }
  console.log(chalk.blue(`PR: ${prUrl}`));
}
