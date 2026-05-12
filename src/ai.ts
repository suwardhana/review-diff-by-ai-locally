import type { Provider } from "./types";
import { DEFAULT_TIMEOUT_MS } from "./types";
import { resolveProviderApiKey } from "./config";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

export async function chatCompletion(
  provider: Provider,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }
): Promise<string> {
  const apiKey = resolveProviderApiKey(provider);
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options?.timeoutMs ?? provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = {
    model: provider.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 16384,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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

  const data = (await response.json()) as ChatCompletionResponse;

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

export interface StreamEvent {
  content?: string;
  reasoning?: string;
  done: boolean;
  premature?: boolean; // stream ended without [DONE] sentinel
}

export async function* chatCompletionStream(
  provider: Provider,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }
): AsyncGenerator<StreamEvent> {
  const apiKey = resolveProviderApiKey(provider);
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options?.timeoutMs ?? provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = {
    model: provider.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 16384,
    stream: true,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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

  if (!response.body) {
    throw new Error(
      `AI provider "${provider.name}" returned an empty response body.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          yield { done: true };
          return;
        }

        try {
          const chunk: StreamChunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          yield {
            content: delta?.content,
            reasoning: delta?.reasoning_content,
            done: false,
          };
        } catch {
          // skip unparseable lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Stream ended without [DONE] — server closed the connection prematurely
  yield { done: true, premature: true };
}

export function buildReviewMessages(
  systemPrompt: string,
  diff: string,
  metadata?: { title: string; body: string },
): ChatMessage[] {
  let userContent = "";

  if (metadata?.title) {
    userContent += `## PR Title\n${metadata.title}\n\n`;
  }
  if (metadata?.body) {
    userContent += `## PR Description\n${metadata.body}\n\n`;
  }

  userContent += `## PR Diff\n\`\`\`diff\n${diff}\n\`\`\``;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

export interface PingResult {
  provider: string;
  model: string;
  baseUrl: string;
  status: "ok" | "fail";
  latencyMs: number;
  response?: string;
  rawResponse?: string;
  error?: string;
}

export async function pingProvider(provider: Provider): Promise<PingResult> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const start = performance.now();
  const timeoutMs = provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const apiKey = resolveProviderApiKey(provider);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 256,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Math.round(performance.now() - start);

    if (!response.ok) {
      const errBody = await response.text();
      let errMsg = `${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error?.message) errMsg = parsed.error.message;
      } catch {}
      return {
        provider: provider.name,
        model: provider.model,
        baseUrl,
        status: "fail",
        latencyMs,
        error: errMsg,
      };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    const reasoning = data.choices?.[0]?.message?.reasoning_content;

    const preview = content?.trim()
      ? content.slice(0, 80)
      : reasoning?.trim()
        ? `[reasoning] ${reasoning.slice(0, 80)}`
        : "pong";

    return {
      provider: provider.name,
      model: provider.model,
      baseUrl,
      status: "ok",
      latencyMs,
      response: preview,
      rawResponse: JSON.stringify(data, null, 2),
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      provider: provider.name,
      model: provider.model,
      baseUrl,
      status: "fail",
      latencyMs,
      error: err.message ?? String(err),
      rawResponse: err.body ?? undefined,
    };
  }
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
