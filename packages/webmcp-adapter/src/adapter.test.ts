import { expect, test } from 'bun:test';
import { createWebMcpRuntime } from './adapter';

test('creates no-op runtime when host is absent', () => {
  const runtime = createWebMcpRuntime({ host: null });
  expect(runtime.isAvailable).toBe(false);

  const registration = runtime.registerTool({
    name: 'ocp.noop',
    description: 'No-op tool',
    handler: () => ({ ok: true }),
  });

  registration.unregister();
  runtime.cleanup();
});

test('registers and unregisters host tools', () => {
  const unregistered: string[] = [];
  const registered: string[] = [];
  const runtime = createWebMcpRuntime({
    host: {
      registerTool(name: unknown) {
        registered.push(String(name));
        return {
          unregister() {
            unregistered.push(String(name));
          },
        };
      },
    },
  });

  expect(runtime.isAvailable).toBe(true);
  const registration = runtime.registerTools([
    { name: 'ocp.first', description: 'First', handler: () => null },
    { name: 'ocp.second', description: 'Second', handler: () => null },
  ]);

  expect(registered).toEqual(['ocp.first', 'ocp.second']);
  registration.unregister();
  registration.unregister();
  expect(unregistered).toEqual(['ocp.second', 'ocp.first']);
});

test('cleanup unregisters active registrations once', () => {
  let count = 0;
  const runtime = createWebMcpRuntime({
    host: {
      registerTool() {
        return () => {
          count += 1;
        };
      },
    },
  });

  runtime.registerTool({ name: 'ocp.cleanup', description: 'Cleanup', handler: () => null });
  runtime.cleanup();
  runtime.cleanup();

  expect(count).toBe(1);
});
