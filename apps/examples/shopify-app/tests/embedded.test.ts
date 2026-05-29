import { describe, expect, test } from 'bun:test';
import { createEmbeddedRoutes, escapeHtml } from '../src/http/embedded';

describe('escapeHtml', () => {
  test('escapes HTML and attribute metacharacters', () => {
    expect(escapeHtml(`<script>"x"&'</script>`)).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;');
  });
});

describe('createEmbeddedRoutes', () => {
  test('does not reflect raw shop query into HTML', async () => {
    const app = createEmbeddedRoutes({
      cfg: { SHOPIFY_APP_API_KEY: 'key' } as any,
      store: { get: async () => null } as any,
    });

    const res = await app.handle(new Request('http://localhost/app?shop=%3Cscript%3Ealert(1)%3C/script%3E'));
    const html = await res.text();

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
