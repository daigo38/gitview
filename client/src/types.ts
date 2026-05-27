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
}

export interface FileContentResponse {
  content: string | null;
  binary: boolean;
  size: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
}

export interface TreeSearchResult {
  matches: TreeEntry[];
  truncated: boolean;
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

export type FileTab = 'file' | 'diff' | 'staged';

export type View =
  | { type: 'repos' }
  | {
      type: 'repo';
      repoId: string;
      repoName: string;
      repoPath: string;
    }
  | {
      type: 'file';
      repoId: string;
      repoName: string;
      repoPath?: string;
      filePath: string;
      tab?: FileTab;
      fileStatus?: FileStatus;
      line?: number;
      query?: string;
    }
  | {
      type: 'commit';
      repoId: string;
      repoName: string;
      hash: string;
      shortHash: string;
      subject: string;
    };

export type NavigateFn = (view: View) => void;
