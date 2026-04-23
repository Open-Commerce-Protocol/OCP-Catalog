import type { AppConfig } from '@ocp-catalog/config';
import { AgentError } from './errors';

export class OpenAiCompatibleClient {
  private readonly baseUrl: string;
  private readonly timeoutMs = 180000;

  constructor(
    private readonly config: AppConfig,
    private readonly model: string,
  ) {
    this.baseUrl = config.OPENAI_BASE_URL.replace(/\/$/, '');
  }

  async completeJson<T>(system: string, user: string): Promise<T> {
    const text = await this.completeText(system, `${user}\n\nReturn JSON only.`);
    const parsed = extractJsonObject(text);
    if (!parsed) {
      throw new AgentError(502, 'invalid_model_output', 'Agent model did not return a valid JSON object');
    }

    try {
      return JSON.parse(parsed) as T;
    } catch (error) {
      throw new AgentError(
        502,
        'invalid_model_output',
        'Agent model returned malformed JSON',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async completeText(system: string, user: string) {
    if (!this.config.OPENAI_API_KEY) {
      throw new AgentError(400, 'validation_error', 'OPENAI_API_KEY is required for the user demo agent');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AgentError(504, 'upstream_timeout', `Agent model request timed out after ${Math.floor(this.timeoutMs / 1000)}s`);
      }
      throw new AgentError(
        502,
        'upstream_unavailable',
        'Agent model request failed before a response was received',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AgentError(
        response.status,
        'internal_error',
        `Agent model request failed: ${response.status} ${response.statusText}`,
        payload,
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
    }

    throw new AgentError(500, 'internal_error', 'Agent model returned no message content', payload);
  }
}

function extractJsonObject(input: string) {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}
