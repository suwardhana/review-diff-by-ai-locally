import type { Provider } from "./types";
import { resolveProviderApiKey } from "./config";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
  };
}

export async function chatCompletion(
  provider: Provider,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const apiKey = resolveProviderApiKey(provider);
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");

  const body = {
    model: provider.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 4096,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(errBody);
      if (parsed.error?.message) errMsg = parsed.error.message;
    } catch {}
    throw new Error(
      `AI provider "${provider.name}" returned an error: ${errMsg}`
    );
  }

  const data: ChatCompletionResponse = await response.json();

  if (data.error) {
    throw new Error(
      `AI provider "${provider.name}" returned an error: ${data.error.message}`
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(
      `AI provider "${provider.name}" returned an empty response.`
    );
  }

  return content;
}

export function buildReviewMessages(
  systemPrompt: string,
  diff: string
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Please review the following pull request diff:\n\n\`\`\`diff\n${diff}\n\`\`\``,
    },
  ];
}

export function formatReviewComment(
  review: string,
  providerName: string,
  model: string,
  truncated: boolean
): string {
  const header = `> **AI Code Review** by \`${providerName}\` (${model})`;
  const warning = truncated
    ? `\n> ⚠️ **Note:** The diff was too large and was truncated before review.\n`
    : "";

  return `${header}${warning}\n\n${review}`;
}
