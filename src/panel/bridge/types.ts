export type FsKind = 'file' | 'directory';

export interface FsEntry {
  name: string;
  path: string;
  kind: FsKind;
  size: number;
  lastModified: number;
  locked: boolean;
}

export interface QuotaInfo {
  usage: number;
  quota: number;
}

export interface FsError {
  code:
    | 'NotFound'
    | 'NotAllowed'
    | 'Locked'
    | 'TypeMismatch'
    | 'BridgeNotInstalled'
    | 'NoOpfs'
    | 'Unknown';
  message: string;
}

export type RpcOp =
  | 'list'
  | 'tree'
  | 'read'
  | 'write'
  | 'mkdir'
  | 'rm'
  | 'move'
  | 'quota'
  | 'stat'
  | 'mtimes';

export interface RpcArgs {
  list: { path: string };
  tree: { path: string; maxDepth?: number };
  read: { path: string; offset?: number; length?: number };
  write: { path: string; b64: string; mode: 'replace' | 'append' };
  mkdir: { path: string };
  rm: { path: string; recursive: boolean };
  move: { from: string; to: string };
  quota: Record<string, never>;
  stat: { path: string };
  mtimes: { path: string };
}

export interface RpcResults {
  list: FsEntry[];
  tree: FsEntry[];
  read: { b64: string; size: number; eof: boolean };
  write: { bytesWritten: number };
  mkdir: void;
  rm: void;
  move: void;
  quota: QuotaInfo;
  stat: FsEntry;
  mtimes: Record<string, number>;
}
