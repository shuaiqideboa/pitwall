import { validateRepoUrl } from './definition';
import { declineMessage, type PolicyDecision, type ReviewedFile } from './policy';

interface FileChange { path: string; content: string | null }
interface Submission { request_id: number; base_sha: string; title: string; body: string; files: FileChange[] }
interface PullRequest { html_url: string; state: string; merged_at: string | null }

function validateSubmission(currentId: number, input: Record<string, unknown>): Submission {
  if (input.request_id !== currentId) throw new Error(`request_id must be ${currentId}.`);
  if (typeof input.base_sha !== 'string' || !/^[a-f0-9]{40}$/.test(input.base_sha)) throw new Error('base_sha must be the full origin/main commit SHA.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) throw new Error('title must be 1–200 characters.');
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 20_000) throw new Error('body must be 1–20000 characters.');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 30) throw new Error('Provide 1–30 changed files.');
  const seen = new Set<string>();
  let bytes = 0;
  for (const file of input.files) {
    if (['src/game/engine.test.ts', 'src/game/balance.test.ts', 'src/game/config.test.ts'].includes(file?.path)) {
      throw new Error('Core rule, fairness and config tests are protected. Add new regression tests in a separate file.');
    }
    if (!file || typeof file.path !== 'string' || !/^(src|public)\/(?:[\w-]+\/)*[\w-][\w.-]*$/.test(file.path)
      || ['src/account.ts', 'src/components/Account.tsx'].includes(file.path)) {
      throw new Error('Only src/ and public/ game files are allowed, excluding account code; no hidden paths or traversal.');
    }
    if (seen.has(file.path)) throw new Error('Duplicate file paths are not allowed.');
    seen.add(file.path);
    if (file.content !== null && (typeof file.content !== 'string' || file.content.includes('\0'))) throw new Error('File content must be UTF-8 text or null for deletion.');
    bytes += Buffer.byteLength(file.content ?? '', 'utf8');
  }
  if (bytes > 1024 * 1024) throw new Error('Changed file content exceeds 1 MiB. Split the change.');
  return input as unknown as Submission;
}

/** Only this server talks to GitHub with the token. No credentials or shell execution in tool results. */
export function githubPublisher(repoUrl: string, token: string, requestId: number, signal: AbortSignal,
  review: (files: ReviewedFile[]) => Promise<PolicyDecision>, fetcher: typeof fetch = fetch) {
  const repo = validateRepoUrl(repoUrl).slice('https://github.com/'.length).replace(/\.git$/, '');
  if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new Error('Invalid request ID.');
  const branch = `pitwall/request-${requestId}`;

  async function api<T>(path: string, method = 'GET', body?: unknown, optional = false): Promise<T | null> {
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com/repos/${repo}/${path}`, {
        method, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      throw new Error('GitHub request failed or timed out. Retry after checking the existing request PR.');
    }
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} failed (HTTP ${response.status}).`);
    return response.json() as Promise<T>;
  }

  async function find() {
    const prs = await api<PullRequest[]>(`pulls?state=all&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}&per_page=100`);
    return prs?.[0] ?? null;
  }
  const result = (pr: PullRequest) => ({ pr_url: pr.html_url, state: pr.merged_at ? 'merged' : pr.state });

  return {
    async lookup(input: Record<string, unknown>) {
      if (input.request_id !== requestId) throw new Error(`request_id must be ${requestId}.`);
      const pr = await find();
      return pr ? result(pr) : { state: 'none' };
    },
    async submit(input: Record<string, unknown>) {
      const submission = validateSubmission(requestId, input);
      const existing = await find();
      if (existing) return result(existing);
      const mainRef = (await api<{ object: { sha: string } }>('git/ref/heads/main'))!;
      const main = (await api<{ sha: string; tree: { sha: string } }>(`git/commits/${mainRef.object.sha}`))!;
      if (main.sha !== submission.base_sha) throw new Error('main has moved. Fetch origin/main, reapply your changes and rerun tests/build before submitting.');
      // Review exact base content and the submitted result, before any GitHub write.
      const files: ReviewedFile[] = [];
      for (const file of submission.files) {
        const original = await api<{ type: string; encoding: string; content: string }>(`contents/${file.path}?ref=${main.sha}`, 'GET', undefined, true);
        if (original && (original.type !== 'file' || original.encoding !== 'base64')) throw new Error('Cannot safely review the original file.');
        files.push({ path: file.path, before: original ? Buffer.from(original.content, 'base64').toString('utf8') : null, after: file.content });
      }
      const decision = await review(files);
      if (decision.decision !== 'allow') throw new Error(`Policy rejected this change: ${declineMessage(decision.reason)} Do not bypass this decision; decline the request.`);
      const tree = (await api<{ sha: string }>('git/trees', 'POST', {
        base_tree: main.tree.sha,
        tree: submission.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', ...(f.content === null ? { sha: null } : { content: f.content }) })),
      }))!;
      if (tree.sha === main.tree.sha) throw new Error('No changes relative to main.');
      const ref = await api<{ object: { sha: string } }>(`git/ref/heads/${branch}`, 'GET', undefined, true);
      if (ref) {
        // A previous attempt may have created the branch before losing the PR response.
        const commit = (await api<{ tree: { sha: string } }>(`git/commits/${ref.object.sha}`))!;
        if (commit.tree.sha !== tree.sha) throw new Error('The request branch already contains different work. Fetch and inspect it; do not overwrite it.');
      } else {
        const commit = (await api<{ sha: string }>('git/commits', 'POST', { message: submission.title, tree: tree.sha, parents: [main.sha] }))!;
        await api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
      }
      const pr = (await api<PullRequest>('pulls', 'POST', { title: submission.title, body: submission.body, head: branch, base: 'main' }))!;
      return result(pr);
    },
  };
}
