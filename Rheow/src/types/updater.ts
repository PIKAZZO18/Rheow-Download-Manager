export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'needsPause'
  | 'installing'
  | 'upToDate'
  | 'error';

export interface UpdateInfo {
  version: string;
  notes: string;
  publishedAt?: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total?: number | null;
  percent: number;
}

export interface UpdaterSettings {
  autoCheck: boolean;
  lastCheckAt?: string | null;
  dismissedVersion?: string | null;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  info?: UpdateInfo | null;
  progress?: UpdateProgress | null;
  activeDownloads: number;
  error?: string | null;
  manual: boolean;
  settings: UpdaterSettings;
  dismissed: boolean;
}
