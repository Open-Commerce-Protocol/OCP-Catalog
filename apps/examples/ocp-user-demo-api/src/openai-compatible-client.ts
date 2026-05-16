import type { AppConfig } from '@ocp-catalog/config';
import { AgentError } from './errors';

export type AgentModelOption = {
  id: string;
  label: string;
  provider: 'openai' | 'qwen';
  model_name: string;
  enabled: boolean;
  reason?: string;
};

type AgentModelRuntimeConfig = {
  id: string;
  label: string;
  provider: 'openai' | 'qwen';
  modelName: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  reason?: string;
};

export class OpenAiCompatibleClient {
  private readonly timeoutMs = 180000;

  constructor(private readonly runtime: AgentModelRuntimeConfig) {}

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
    if (!this.runtime.enabled || !this.runtime.apiKey) {
      throw new AgentError(
        400,
        'validation_error',
        this.runtime.reason ?? `${this.runtime.provider.toUpperCase()} API key is required for the user demo agent`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.runtime.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.runtime.apiKey}`,
        },
        body: JSON.stringify({
          model: this.runtime.modelName,
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

export function buildAgentModelOptions(config: AppConfig): AgentModelOption[] {
  return buildAgentModelRegistry(config).map((item) => ({
    id: item.id,
    label: item.label,
    provider: item.provider,
    model_name: item.modelName,
    enabled: item.enabled,
    ...(item.reason ? { reason: item.reason } : {}),
  }));
}

export function resolveDefaultAgentModelId(config: AppConfig) {
  const registry = buildAgentModelRegistry(config);
  const preferred = registry.find((item) => item.id === config.USER_DEMO_AGENT_MODEL || item.modelName === config.USER_DEMO_AGENT_MODEL);
  if (preferred?.enabled) return preferred.id;

  const firstEnabled = registry.find((item) => item.enabled);
  return firstEnabled?.id ?? preferred?.id ?? registry[0]?.id ?? config.USER_DEMO_AGENT_MODEL;
}

export function createAgentModelClient(config: AppConfig, requestedModelId?: string | null) {
  const registry = buildAgentModelRegistry(config);
  const explicitRequest = requestedModelId?.trim();
  const requestedId = explicitRequest || config.USER_DEMO_AGENT_MODEL;
  const runtime = registry.find((item) => item.id === requestedId || item.modelName === requestedId);

  if (!runtime) {
    throw new AgentError(400, 'validation_error', `Unsupported agent model: ${requestedId}`, {
      supported_models: registry.map((item) => item.id),
    });
  }

  if (!explicitRequest && !runtime.enabled) {
    const fallback = registry.find((item) => item.enabled);
    if (fallback) {
      return new OpenAiCompatibleClient(fallback);
    }
  }

  if (!runtime.enabled) {
    throw new AgentError(
      400,
      'validation_error',
      runtime.reason ?? `Model ${runtime.id} is not configured`,
      {
        model_id: runtime.id,
        provider: runtime.provider,
      },
    );
  }

  return new OpenAiCompatibleClient(runtime);
}

function buildAgentModelRegistry(config: AppConfig): AgentModelRuntimeConfig[] {
  return [
    {
      id: 'openai-default',
      label: `OpenAI / ${config.OPENAI_MODEL_NAME}`,
      provider: 'openai',
      modelName: config.OPENAI_MODEL_NAME,
      apiKey: config.OPENAI_API_KEY,
      baseUrl: normalizeBaseUrl(config.OPENAI_BASE_URL),
      enabled: Boolean(config.OPENAI_API_KEY),
      reason: config.OPENAI_API_KEY ? undefined : 'OPENAI_API_KEY is required for the OpenAI user demo model',
    },
    {
      id: 'qwen-default',
      label: `Qwen / ${config.QWEN_MODEL_NAME}`,
      provider: 'qwen',
      modelName: config.QWEN_MODEL_NAME,
      apiKey: config.QWEN_API_KEY,
      baseUrl: normalizeBaseUrl(config.QWEN_BASE_URL),
      enabled: Boolean(config.QWEN_API_KEY),
      reason: config.QWEN_API_KEY ? undefined : 'QWEN_API_KEY is required for the Qwen user demo model',
    },
  ];
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
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
