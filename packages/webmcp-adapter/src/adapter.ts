import type { WebMcpHost, WebMcpRuntime, WebMcpRuntimeOptions, WebMcpTool, WebMcpToolRegistration } from './types';

type HostRegistration =
  | undefined
  | null
  | (() => void)
  | { unregister?: () => void; remove?: () => void; dispose?: () => void };

type RegisterToolFunction = (...args: unknown[]) => HostRegistration;

export function createWebMcpRuntime(options: WebMcpRuntimeOptions = {}): WebMcpRuntime {
  const host = options.host === undefined ? getDefaultHost() : options.host;
  const registerTool = isRegisterToolHost(host) ? host.registerTool.bind(host) : null;
  const registrations = new Set<WebMcpToolRegistration>();

  const runtime: WebMcpRuntime = {
    isAvailable: Boolean(registerTool),
    registerTool<TInput = unknown, TResult = unknown>(tool: WebMcpTool<TInput, TResult>) {
      if (!registerTool) return noopRegistration;

      let active = true;
      const hostRegistration = registerHostTool(registerTool, tool);
      const registration = {
        unregister() {
          if (!active) return;
          active = false;
          unregisterHostTool(hostRegistration);
          registrations.delete(registration);
        },
      };
      registrations.add(registration);
      return registration;
    },
    registerTools(tools: readonly WebMcpTool[]) {
      const childRegistrations = tools.map((tool) => runtime.registerTool(tool));
      let active = true;
      return {
        unregister() {
          if (!active) return;
          active = false;
          for (const registration of [...childRegistrations].reverse()) {
            registration.unregister();
          }
        },
      };
    },
    cleanup() {
      for (const registration of Array.from(registrations).reverse()) {
        registration.unregister();
      }
    },
  };

  return runtime;
}

export function registerWebMcpTools(
  tools: readonly WebMcpTool[],
  options: WebMcpRuntimeOptions = {},
): WebMcpToolRegistration {
  return createWebMcpRuntime(options).registerTools(tools);
}

function getDefaultHost(): WebMcpHost | null {
  const navigatorValue = globalThis.navigator as (Navigator & { modelContext?: WebMcpHost }) | undefined;
  return navigatorValue?.modelContext ?? null;
}

function isRegisterToolHost(host: WebMcpHost | null | undefined): host is { registerTool: RegisterToolFunction } {
  return typeof host?.registerTool === 'function';
}

function registerHostTool<TInput, TResult>(
  registerTool: RegisterToolFunction,
  tool: WebMcpTool<TInput, TResult>,
): HostRegistration {
  return registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    tool.handler,
  );
}

function unregisterHostTool(registration: HostRegistration) {
  if (typeof registration === 'function') {
    registration();
    return;
  }

  registration?.unregister?.();
  registration?.remove?.();
  registration?.dispose?.();
}

const noopRegistration: WebMcpToolRegistration = {
  unregister() {},
};
