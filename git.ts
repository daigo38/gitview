import { execFile, type ExecFileException } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export interface ScanConfig {
  scanDirs?: string[];
  repos?: string[];
  port?: number;
  ignoreDirs?: string[];
  scanDepth?: number;
}

export interface FileStatus {
  x: string;
  y: string;
  path: string;
  isUntracked: boolean;
  isStaged: boolean;
  isUnstaged: boolean;
}

export interface RepoSummary {
  id: string;
  name: string;
  parentName: string | null;
  path: string;
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
  totalChanged: number;
  clean: boolean;
  lastActivityAt: number;
}

export interface RepoDetail {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

export interface RepoDetailOptions {
  fetchRemote?: boolean;
}

export interface LogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface TreeEntry {
  name: string;
  type: 'dir' | 'file';
  path: string;
  ignored?: boolean;
}

export interface FileContent {
  content: string | null;
  binary: boolean;
  size: number;
}

export interface CommitDetail {
  fullHash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  body: string;
  diff: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

const STATUS_ARGS = ['status', '--porcelain', '-z', '--untracked-files=all'];

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

export interface TreeSearchResult {
  matches: TreeEntry[];
  truncated: boolean;
}

function execGit(args: readonly string[], cwd: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, maxBuffer: 20 * 1024 * 1024, timeout },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
  });
}

function execGitWithInput(
  args: readonly string[],
  cwd: string,
  input: string,
  timeout = 15000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, maxBuffer: 20 * 1024 * 1024, timeout },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err && err.code === 1 && !stderr) {
          resolve('');
          return;
        }
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
}

// git grep は「マッチなし」で exit 1 を返すので、それをエラー扱いしない版
function execGitGrep(args: readonly string[], cwd: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, maxBuffer: 50 * 1024 * 1024, timeout },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err && err.code === 1 && !stderr) {
          resolve('');
          return;
        }
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function getIgnoredPathSet(repoPath: string, paths: readonly string[]): Promise<Set<string>> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return new Set();

  try {
    const out = await execGitWithInput(
      ['check-ignore', '--stdin', '-z'],
      repoPath,
      `${uniquePaths.join('\0')}\0`,
    );
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

async function markIgnoredEntries(repoPath: string, entries: TreeEntry[]): Promise<TreeEntry[]> {
  const ignored = await getIgnoredPathSet(repoPath, entries.map(e => e.path));
  if (ignored.size === 0) return entries;
  return entries.map(entry => (
    ignored.has(entry.path) ? { ...entry, ignored: true } : entry
  ));
}

// push/pull など stderr に進行表示が出る系は stdout/stderr を両方返したい
function execGitCombined(
  args: readonly string[],
  cwd: string,
  timeout = 120000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd, maxBuffer: 20 * 1024 * 1024, timeout },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        if (err) {
          const msg = [stderr.trim(), stdout.trim(), err.message]
            .filter(Boolean)
            .join('\n');
          reject(new Error(msg || 'git command failed'));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export function encodeId(repoPath: string): string {
  return Buffer.from(repoPath).toString('base64url');
}

export function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf-8');
}

// node_modules等を除いて再帰的に .git ディレクトリを探す
export async function scanRepos(config: ScanConfig): Promise<string[]> {
  const SKIP = new Set<string>([
    'node_modules', '.git', 'vendor', 'dist', 'build',
    '.cache', '.next', 'coverage', '__pycache__',
    ...(config.ignoreDirs ?? []),
  ]);
  const MAX_DEPTH = config.scanDepth ?? 6;
  const found = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some(e => e.name === '.git' && (e.isDirectory() || e.isFile()))) {
      found.add(dir);
      // .git があってもネストした repos のために継続
    }

    await Promise.all(
      entries
        .filter(e => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
        .map(e => walk(path.join(dir, e.name), depth + 1)),
    );
  }

  await Promise.all((config.scanDirs ?? []).map(d => walk(d, 0)));

  // 明示的に指定された repos も追加
  for (const repo of config.repos ?? []) {
    try {
      await fs.promises.access(path.join(repo, '.git'));
      found.add(repo);
    } catch {
      // ignore unreachable repo
    }
  }

  return [...found].sort();
}

// `git status --porcelain -z --untracked-files=all` の出力をパースする。
// `-z` を使うのは、特殊文字（"、\、制御文字、非ASCII 等）を含むパスが
// クォート＆エスケープされてしまうのを避けるため。NUL 終端なら生パスのまま得られる。
function parseStatus(output: string): FileStatus[] {
  if (!output) return [];
  const entries = output.split('\0');
  const files: FileStatus[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 3) continue;
    const x = entry.charAt(0);
    const y = entry.charAt(1);
    const filePath = entry.slice(3);
    // R/C エントリは続く NUL の後ろに元パスが入っているので消費する
    if (x === 'R' || x === 'C') i++;
    files.push({
      x,
      y,
      path: filePath,
      isUntracked: x === '?' && y === '?',
      isStaged: x !== ' ' && x !== '?',
      isUnstaged: y !== ' ' && y !== '?',
    });
  }
  return files;
}

function isDotfile(filePath: string): boolean {
  return filePath.split('/').some(part => part.startsWith('.'));
}

async function getWorktreeParent(repoPath: string): Promise<string | null> {
  try {
    const gitPath = path.join(repoPath, '.git');
    const stat = await fs.promises.stat(gitPath);
    if (!stat.isFile()) return null;
    const content = await fs.promises.readFile(gitPath, 'utf-8');
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match || match[1] === undefined) return null;
    // gitdir: /path/to/parent/.git/worktrees/branch-name
    const parentPath = match[1].trim().replace(/\/\.git\/worktrees\/[^/]+\/?$/, '');
    return path.basename(parentPath);
  } catch {
    return null;
  }
}

export async function getRepoSummary(repoPath: string): Promise<RepoSummary> {
  const [statusOut, branchOut, lastCommitOut, parentName] = await Promise.all([
    execGit(STATUS_ARGS, repoPath).catch(() => ''),
    execGit(['branch', '--show-current'], repoPath).catch(() => ''),
    execGit(['log', '-1', '--format=%ct'], repoPath).catch(() => '0'),
    getWorktreeParent(repoPath),
  ]);

  const files = parseStatus(statusOut);
  const staged    = files.filter(f => f.isStaged).length;
  const unstaged  = files.filter(f => !f.isUntracked && f.isUnstaged).length;
  const untracked = files.filter(f => f.isUntracked).length;
  const lastCommitAt = parseInt(lastCommitOut.trim(), 10) || 0;

  // 変更ファイル（ドットファイル除外）の中で最も新しいmtimeを取得
  const changedNonDot = files.filter(f => !isDotfile(f.path));
  const mtimes = await Promise.all(
    changedNonDot.map(f =>
      fs.promises.stat(path.join(repoPath, f.path))
        .then(s => Math.floor(s.mtimeMs / 1000))
        .catch(() => 0),
    ),
  );
  const lastModifiedAt = mtimes.length > 0 ? Math.max(...mtimes) : 0;

  return {
    id: encodeId(repoPath),
    name: path.basename(repoPath),
    parentName: parentName ?? null,
    path: repoPath,
    branch: branchOut.trim() || 'HEAD',
    staged,
    unstaged,
    untracked,
    totalChanged: staged + unstaged + untracked,
    clean: staged === 0 && unstaged === 0 && untracked === 0,
    lastActivityAt: Math.max(lastCommitAt, lastModifiedAt),
  };
}

export async function fetchRemotes(repoPath: string): Promise<void> {
  const remotes = await execGit(['remote'], repoPath).catch(() => '');
  if (!remotes.trim()) return;
  await execGitCombined(['fetch', '--quiet', '--prune', '--no-tags'], repoPath);
}

export async function getRepoDetail(
  repoPath: string,
  options: RepoDetailOptions = {},
): Promise<RepoDetail> {
  if (options.fetchRemote) {
    await fetchRemotes(repoPath);
  }

  const [statusOut, branchOut] = await Promise.all([
    execGit(STATUS_ARGS, repoPath).catch(() => ''),
    execGit(['branch', '--show-current'], repoPath).catch(() => ''),
  ]);

  const files = parseStatus(statusOut);
  const branch = branchOut.trim() || 'HEAD';

  let ahead = 0;
  let behind = 0;
  try {
    const upstream = (await execGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      repoPath,
    )).trim();
    const aheadBehindOut = await execGit(
      ['rev-list', '--left-right', '--count', `${upstream}...HEAD`],
      repoPath,
    );
    const parts = aheadBehindOut.trim().split(/\s+/);
    behind = parseInt(parts[0] ?? '0', 10) || 0;
    ahead = parseInt(parts[1] ?? '0', 10) || 0;
  } catch {
    // upstream branch may not exist; leave ahead/behind at 0
  }

  return {
    id: encodeId(repoPath),
    name: path.basename(repoPath),
    path: repoPath,
    branch,
    ahead,
    behind,
    files,
  };
}

export async function getLog(repoPath: string, count = 30): Promise<LogEntry[]> {
  try {
    const out = await execGit(
      ['log', `--max-count=${count}`, '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ar'],
      repoPath,
    );
    return out.trim().split('\n').filter(Boolean).map((line): LogEntry => {
      const [hash, shortHash, subject, author, date] = line.split('\x00');
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        subject: subject ?? '',
        author: author ?? '',
        date: date ?? '',
      };
    });
  } catch {
    return [];
  }
}

export async function getFileTree(
  repoPath: string,
  subPath = '',
  ignoreDirs: readonly string[] = [],
): Promise<TreeEntry[]> {
  const safeIgnore = new Set<string>([...ignoreDirs, '.git']);
  const fullPath = validatePath(repoPath, subPath);

  const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
  const treeEntries = entries
    .filter(e => !safeIgnore.has(e.name))
    .map((e): TreeEntry => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: subPath ? `${subPath}/${e.name}` : e.name,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return markIgnoredEntries(repoPath, treeEntries);
}

export async function searchFileTree(
  repoPath: string,
  query: string,
  ignoreDirs: readonly string[] = [],
  limit = 500,
): Promise<TreeSearchResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { matches: [], truncated: false };

  const safeIgnore = new Set<string>([...ignoreDirs, '.git']);
  const max = Math.min(Math.max(limit, 1), 2000);
  const matches: TreeEntry[] = [];
  let truncated = false;

  async function walk(subPath: string): Promise<void> {
    if (truncated) return;
    const fullPath = validatePath(repoPath, subPath);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (safeIgnore.has(entry.name)) continue;
      const entryPath = subPath ? `${subPath}/${entry.name}` : entry.name;
      const treeEntry: TreeEntry = {
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file',
        path: entryPath,
      };

      if (entry.name.toLowerCase().includes(q) || entryPath.toLowerCase().includes(q)) {
        if (matches.length >= max) {
          truncated = true;
          return;
        }
        matches.push(treeEntry);
      }

      if (entry.isDirectory()) {
        await walk(entryPath);
        if (truncated) return;
      }
    }
  }

  await walk('');
  const markedMatches = await markIgnoredEntries(repoPath, matches);
  return { matches: markedMatches, truncated };
}

export async function getFileContent(repoPath: string, filePath: string): Promise<FileContent> {
  const fullPath = validatePath(repoPath, filePath);
  const buffer = await fs.promises.readFile(fullPath);

  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) return { content: null, binary: true, size: buffer.length };
  }

  return { content: buffer.toString('utf-8'), binary: false, size: buffer.length };
}

export async function getDiff(repoPath: string, filePath: string, staged = false): Promise<string> {
  const args: string[] = ['diff'];
  if (staged) args.push('--cached');
  if (filePath) args.push('--', filePath);
  try {
    return await execGit(args, repoPath);
  } catch {
    return '';
  }
}

export async function getFullDiff(repoPath: string): Promise<{ unstaged: string; staged: string }> {
  try {
    const [unstaged, staged] = await Promise.all([
      execGit(['diff'], repoPath),
      execGit(['diff', '--cached'], repoPath),
    ]);
    return { unstaged, staged };
  } catch {
    return { unstaged: '', staged: '' };
  }
}

function validatePath(repoPath: string, filePath: string): string {
  const resolved = path.resolve(repoPath, filePath);
  const base = path.resolve(repoPath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function validateRelativePaths(files: readonly string[] | undefined): void {
  for (const f of files ?? []) {
    if (typeof f !== 'string') throw new Error('Invalid path');
    const norm = path.normalize(f);
    if (path.isAbsolute(norm) || norm.startsWith('..')) throw new Error('Path traversal detected');
  }
}

// `git grep` で全文検索。
// - ファイルシステム walk せず git index を使うので速い
// - `.gitignore` を自動で尊重し、`--untracked` で未追跡ファイルも対象（ignored は除外される）
// - `-I` でバイナリ除外、`-z` でパスを NUL 区切りにして安全にパース
// - `-F` 既定でリテラル検索（正規表現はオプション）
// - 各ファイル最大 `--max-count`、全体は `limit` で打ち切り
export async function searchInRepo(
  repoPath: string,
  query: string,
  options: {
    caseSensitive?: boolean;
    regex?: boolean;
    subPath?: string;
    pathQuery?: string;
    limit?: number;
    maxPerFile?: number;
  } = {},
): Promise<SearchResult> {
  if (!query) return { matches: [], truncated: false };

  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const maxPerFile = Math.min(Math.max(options.maxPerFile ?? 20, 1), 200);
  const pathQuery = options.pathQuery?.trim().toLowerCase() ?? '';

  const args: string[] = [
    'grep',
    '-I',                      // バイナリ除外
    '-n',                      // 行番号
    '-z',                      // パスを NUL 区切り
    '--no-color',
    '--untracked',             // 未追跡ファイルも検索（ignored は自動除外）
    `--max-count=${maxPerFile}`,
  ];
  if (!options.caseSensitive) args.push('-i');
  if (!options.regex) args.push('-F'); // リテラル検索
  args.push('-e', query);

  if (options.subPath) {
    // `--` 以降は pathspec として安全
    args.push('--', options.subPath);
  }

  const out = await execGitGrep(args, repoPath);
  if (!out) return { matches: [], truncated: false };

  // 出力フォーマット: `<path>\0<line>\0<text>\n`
  // （`-z` + `-n` でフィールド区切りも NUL になる）
  const matches: SearchMatch[] = [];
  let truncated = false;
  const records = out.split('\n');
  for (const record of records) {
    if (!record) continue;
    const firstNul = record.indexOf('\0');
    if (firstNul === -1) continue;
    const secondNul = record.indexOf('\0', firstNul + 1);
    if (secondNul === -1) continue;
    const filePath = record.slice(0, firstNul);
    if (pathQuery && !filePath.toLowerCase().includes(pathQuery)) continue;
    const lineNum = parseInt(record.slice(firstNul + 1, secondNul), 10);
    if (!Number.isFinite(lineNum)) continue;
    let text = record.slice(secondNul + 1);
    // ペイロード肥大対策: 1 行 500 文字で切る
    if (text.length > 500) text = text.slice(0, 500) + '…';
    matches.push({ path: filePath, line: lineNum, text });
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
  }
  return { matches, truncated };
}

export async function getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
  const [info, diff] = await Promise.all([
    execGit(['log', '-1', '--format=%H%x00%h%x00%s%x00%an%x00%ar%x00%b', hash], repoPath).catch(() => ''),
    execGit(['show', hash, '--format='], repoPath).catch(() => ''),
  ]);
  const parts = info.split('\x00');
  return {
    fullHash: parts[0]?.trim() || hash,
    shortHash: parts[1]?.trim() || hash.slice(0, 7),
    subject: parts[2]?.trim() ?? '',
    author: parts[3]?.trim() ?? '',
    date: parts[4]?.trim() ?? '',
    body: parts[5]?.trim() ?? '',
    diff: diff.replace(/^\s*\n/, '').trimEnd(),
  };
}

export async function stageFiles(repoPath: string, files?: readonly string[]): Promise<void> {
  validateRelativePaths(files);
  const args = files?.length ? ['add', '--', ...files] : ['add', '-A'];
  await execGit(args, repoPath);
}

export async function unstageFiles(repoPath: string, files?: readonly string[]): Promise<void> {
  validateRelativePaths(files);
  try {
    const args = files?.length ? ['reset', 'HEAD', '--', ...files] : ['reset', 'HEAD'];
    await execGit(args, repoPath);
  } catch {
    // No HEAD yet (initial commit) — use rm --cached
    const args = files?.length ? ['rm', '--cached', '--', ...files] : ['rm', '-r', '--cached', '.'];
    await execGit(args, repoPath);
  }
}

export async function discardFiles(repoPath: string, files?: readonly string[]): Promise<void> {
  validateRelativePaths(files);
  const args = files?.length ? ['restore', '--', ...files] : ['restore', '.'];
  await execGit(args, repoPath);
}

export async function cleanFiles(repoPath: string, files?: readonly string[]): Promise<void> {
  validateRelativePaths(files);
  const args = files?.length ? ['clean', '-f', '--', ...files] : ['clean', '-f', '.'];
  await execGit(args, repoPath);
}

export async function commitChanges(repoPath: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Commit message is required');
  await execGit(['commit', '-m', trimmed], repoPath);
}

// stderr のほうが人間向けの進行表示が入ることが多いので、両方くっつけて整形して返す
function formatGitOutput(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
}

export async function pushChanges(repoPath: string): Promise<string> {
  const { stdout, stderr } = await execGitCombined(['push'], repoPath);
  return formatGitOutput(stdout, stderr);
}

export async function pullChanges(repoPath: string): Promise<string> {
  // --ff-only: 自動でマージコミットや rebase を起こさず、競合があれば失敗させる
  const { stdout, stderr } = await execGitCombined(['pull', '--ff-only'], repoPath);
  return formatGitOutput(stdout, stderr);
}

export { validatePath as validatePathPublic };
