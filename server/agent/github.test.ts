import { describe, expect, it, vi } from 'vitest';
import { githubPublisher } from './github';
import type { PolicyDecision } from './policy';

const base = 'a'.repeat(40);
const input = { request_id: 12, base_sha: base, title: 'Improve lap label', body: 'Tested game change.', files: [{ path: 'src/example.ts', content: 'export const label = "Lap";\n' }] };
const pr = { html_url: 'https://github.com/o/r/pull/8', state: 'open', merged_at: null };
function fixture(responses: [unknown, number?][]) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/contents/')) return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from('export const label = "Old";\n').toString('base64') }));
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return new Response(JSON.stringify(next[0]), { status: next[1] ?? 200 });
  });
  const review = vi.fn(async (): Promise<PolicyDecision> => ({ decision: 'allow', reason: 'in_scope' }));
  return { fetcher, review, publisher: githubPublisher('https://github.com/o/r', 'private-token', 12, new AbortController().signal, review, fetcher as typeof fetch) };
}

describe('server-owned GitHub publishing', () => {
  it('rejects invalid requests, protected files, traversal and oversized changes before any API call', async () => {
    const { fetcher, review, publisher } = fixture([]);
    await expect(publisher.lookup({ request_id: 13 })).rejects.toThrow(/12/);
    await expect(publisher.submit({ ...input, request_id: 13 })).rejects.toThrow(/12/);
    for (const path of ['src/game/engine.test.ts', 'src/game/config.test.ts', 'src/game/balance.test.ts']) {
      for (const content of [null, 'test.skip("fairness", () => {});']) {
        await expect(publisher.submit({ ...input, files: [{ path, content }] })).rejects.toThrow(/protected/);
      }
    }
    for (const path of ['server/app.ts', '.github/workflows/ci.yml', 'package.json', 'src/../server/app.ts', 'src/.env', 'src/account.ts', 'src/components/Account.tsx']) {
      await expect(publisher.submit({ ...input, files: [{ path, content: 'bad' }] })).rejects.toThrow(/Only src/);
    }
    await expect(publisher.submit({ ...input, files: [input.files[0], input.files[0]] })).rejects.toThrow(/Duplicate/);
    await expect(publisher.submit({ ...input, files: [{ path: 'src/x.ts', content: 'x'.repeat(1024 * 1024 + 1) }] })).rejects.toThrow(/1 MiB/);
    expect(review).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reviews exact code and blocks every write on rejection or review failure', async () => {
    for (const failure of ['rejected', 'unavailable']) {
      const { fetcher, review, publisher } = fixture([[[]], [{ object: { sha: base } }], [{ sha: base, tree: { sha: 'base-tree' } }]]);
      if (failure === 'rejected') review.mockResolvedValue({ decision: 'decline', reason: 'unfair' });
      else review.mockRejectedValue(new Error('review unavailable'));
      await expect.soft(publisher.submit(input), failure).rejects.toThrow(failure === 'rejected' ? /Policy rejected/ : /review unavailable/);
      expect.soft(review, failure).toHaveBeenCalledWith([{ path: 'src/example.ts', before: 'export const label = "Old";\n', after: input.files[0].content }]);
      const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
      expect.soft(calls.every(([, init]) => init.method === 'GET'), failure).toBe(true);
    }
  });
  it('returns existing open or merged PRs without publishing another', async () => {
    for (const existing of [pr, { ...pr, state: 'closed', merged_at: '2026-11-11' }]) {
      const { publisher, fetcher } = fixture([[[existing]], [[existing]]]);
      const expected = { pr_url: pr.html_url, state: existing.merged_at ? 'merged' : 'open' };
      expect(await publisher.lookup({ request_id: 12 })).toEqual(expected);
      expect(await publisher.submit(input)).toEqual(expected);
      const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
      expect(calls.every(([, init]) => init.method === 'GET')).toBe(true);
    }
  });
  it('requires revalidation if main moved, before any mutation', async () => {
    const { publisher, fetcher } = fixture([[[]], [{ object: { sha: 'b'.repeat(40) } }], [{ sha: 'b'.repeat(40), tree: { sha: 'base-tree' } }]]);
    await expect(publisher.submit(input)).rejects.toThrow(/main has moved/);
    expect(fetcher.mock.calls.every((call) => (call as unknown as [string, RequestInit])[1].method === 'GET')).toBe(true);
  });
  it('creates only the current request branch and a PR, with credentials sent directly to GitHub', async () => {
    const { publisher, fetcher } = fixture([[[]], [{ object: { sha: base } }], [{ sha: base, tree: { sha: 'base-tree' } }], [{ sha: 'new-tree' }], [{}, 404], [{ sha: 'new-commit' }], [{}], [pr]]);
    expect(await publisher.submit(input)).toEqual({ pr_url: pr.html_url, state: 'open' });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    for (const [url, options] of calls) {
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/o\/r\//);
      expect(options.redirect).toBe('error');
      expect(options.headers).toMatchObject({ Authorization: 'Bearer private-token' });
    }
    const bodyFor = (path: string) => JSON.parse(calls.find(([url, options]) => url.endsWith(path) && options.method === 'POST')![1].body as string);
    expect(bodyFor('/git/trees')).toMatchObject({ base_tree: 'base-tree', tree: [{ path: 'src/example.ts', mode: '100644', type: 'blob', content: input.files[0].content }] });
    expect(bodyFor('/git/refs')).toEqual({ ref: 'refs/heads/pitwall/request-12', sha: 'new-commit' });
    expect(bodyFor('/pulls')).toMatchObject({ head: 'pitwall/request-12', base: 'main' });
  });
  it('recovers a branch created before a failed PR response without overwriting commits', async () => {
    const { publisher, fetcher } = fixture([[[]], [{ object: { sha: base } }], [{ sha: base, tree: { sha: 'base-tree' } }], [{ sha: 'new-tree' }], [{ object: { sha: 'existing-commit' } }], [{ tree: { sha: 'new-tree' } }], [pr]]);
    expect(await publisher.submit(input)).toEqual({ pr_url: pr.html_url, state: 'open' });
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls.filter(([, init]) => init.method === 'POST').map(([url]) => url.split('/').at(-1))).toEqual(['trees', 'pulls']);
  });
  it('never overwrites differing work on an existing request branch', async () => {
    const { publisher, fetcher } = fixture([[[]], [{ object: { sha: base } }], [{ sha: base, tree: { sha: 'base-tree' } }], [{ sha: 'new-tree' }], [{ object: { sha: 'existing-commit' } }], [{ tree: { sha: 'different-tree' } }]]);
    await expect(publisher.submit(input)).rejects.toThrow(/different work/);
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls.filter(([, init]) => init.method !== 'GET').every(([url]) => url.endsWith('/git/trees'))).toBe(true);
  });
  it('does not expose response bodies or credentials in API failures', async () => {
    const { publisher } = fixture([[{ message: 'private-token' }, 403]]);
    await expect(publisher.lookup({ request_id: 12 })).rejects.toThrow('GitHub GET failed (HTTP 403).');
  });
});
