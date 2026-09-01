// LLM client for Qwen3 on VPS (Ollama API)
// Uses Ollama native API (/api/chat) which supports `think: false` to disable
// Qwen3's reasoning mode for much faster responses.

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmResponse = {
  content: string;
  reasoning: string | null;
  tokensUsed: number;
  ok: boolean;
  error?: string;
};

function getLlmBaseUrl(): string {
  // For Ollama native API, we strip /v1 if present
  const url = process.env.LLM_BASE_URL ?? "http://5.223.78.194:11434/v1";
  return url.replace(/\/v1\/?$/, "");
}

function getLlmModel(): string {
  return process.env.LLM_MODEL ?? "qwen3:4b";
}

function getLlmApiKey(): string | undefined {
  return process.env.LLM_API_KEY;
}

function getLlmTimeoutMs(): number {
  return Number(process.env.LLM_TIMEOUT_MS ?? 60000);
}

// Call the LLM using Ollama native API (/api/chat)
// Disables Qwen3 thinking mode by default for faster responses
export async function chatCompletion(
  messages: LlmMessage[],
  options?: { maxTokens?: number; temperature?: number; enableThinking?: boolean }
): Promise<LlmResponse> {
  const baseUrl = getLlmBaseUrl();
  const model = getLlmModel();
  const apiKey = getLlmApiKey();
  const timeoutMs = getLlmTimeoutMs();
  const enableThinking = options?.enableThinking ?? false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // Ollama native API body
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    think: enableThinking,
    options: {
      num_predict: options?.maxTokens ?? 800,
      temperature: options?.temperature ?? 0.3
    }
  };

  // AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      return {
        content: "",
        reasoning: null,
        tokensUsed: 0,
        ok: false,
        error: `LLM returned status ${response.status}: ${text.slice(0, 200)}`
      };
    }

    const data = await response.json();
    const content = data.message?.content ?? "";
    const reasoning = data.message?.reasoning ?? null;
    // Ollama returns eval_count for output tokens
    const tokensUsed = (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0);

    return {
      content: content.trim(),
      reasoning,
      tokensUsed,
      ok: true
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      return {
        content: "",
        reasoning: null,
        tokensUsed: 0,
        ok: false,
        error: `LLM request timed out after ${timeoutMs}ms`
      };
    }

    return {
      content: "",
      reasoning: null,
      tokensUsed: 0,
      ok: false,
      error: error instanceof Error ? error.message : "LLM request failed"
    };
  }
}

// Simple helper for single-prompt queries
export async function askLlm(
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; temperature?: number; enableThinking?: boolean }
): Promise<LlmResponse> {
  return chatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    options
  );
}

// Check if LLM is configured and available
export function isLlmConfigured(): boolean {
  return !!(process.env.LLM_BASE_URL && process.env.LLM_MODEL);
}
