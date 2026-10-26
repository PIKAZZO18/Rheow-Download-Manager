export type ConnectionSpeedPreset = 'high_speed' | 'medium_speed' | 'low_speed';

export const CATEGORY_SUBFOLDER_KEYS = [
  'Compressed',
  'Programs',
  'Video',
  'Documents',
  'Music',
  'Other',
] as const;

export type CategorySubfolderKey = (typeof CATEGORY_SUBFOLDER_KEYS)[number];

export const DEFAULT_CATEGORY_SUBFOLDERS: Record<CategorySubfolderKey, string> = {
  Compressed: 'Compressed',
  Programs: 'Programs',
  Video: 'Video',
  Documents: 'Documents',
  Music: 'Music',
  Other: 'General',
};

export type SpeedLimiterMode = 'per_download' | 'global';

export interface RheowSettings {
  maxConnections: number; // 1, 2, 4, 8, 16, 24, 32
  connectionSpeedPreset: ConnectionSpeedPreset;
  defaultDownloadPath: string;
  connectionTimeoutSeconds: number;
  maxRetries: number;
  preallocateDiskSpace: boolean;
  openFolderOnFinishDefault: boolean;
  confirmDeletePrompt: boolean;
  deleteFileFromDiskDefault: boolean;
  autostartEnabled: boolean;
  closeToTray: boolean;
  startMinimized: boolean;
  /** Category -> subfolder name (relative) or absolute folder path. Empty means no subfolder. */
  categorySubfolders: Record<string, string>;
  /** Speed limiter mode: 'per_download' (Hero Active / individual) or 'global' (all downloads). */
  speedLimiterMode: SpeedLimiterMode;
  /** Global speed limit in KB/s when speedLimiterMode === 'global'. */
  globalSpeedLimitKb?: number | null;
}

export type SchedulerActionOnFinish = 'none' | 'shutdown' | 'sleep' | 'quit';

export interface SchedulerSettings {
  enabled: boolean;
  startTime: string; // "HH:MM" e.g. "02:00"
  stopTime?: string | null; // "HH:MM" e.g. "06:00"
  days: number[]; // 1 = Mon ... 7 = Sun, empty = everyday
  actionOnFinish: SchedulerActionOnFinish;
  maxConcurrentQueue: number; // 1 to 10
}

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  enabled: false,
  startTime: '02:00',
  stopTime: '06:00',
  days: [],
  actionOnFinish: 'none',
  maxConcurrentQueue: 2,
};

export interface QueueDetails {
  isRunning: boolean;
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
}

export const DEFAULT_SETTINGS: RheowSettings = {
  maxConnections: 8,
  connectionSpeedPreset: 'high_speed',
  defaultDownloadPath: '',
  connectionTimeoutSeconds: 30,
  maxRetries: 10,
  preallocateDiskSpace: true,
  openFolderOnFinishDefault: true,
  confirmDeletePrompt: true,
  deleteFileFromDiskDefault: false,
  autostartEnabled: false,
  closeToTray: true,
  startMinimized: false,
  categorySubfolders: { ...DEFAULT_CATEGORY_SUBFOLDERS },
  speedLimiterMode: 'per_download',
  globalSpeedLimitKb: null,
};

export const CONNECTION_COUNT_OPTIONS = [1, 2, 4, 8, 16, 24, 32] as const;

/** Merges persisted settings with defaults, including the nested category map. */
export function withSettingsDefaults(
  partial?: Partial<RheowSettings> | null
): RheowSettings {
  let defaultDownloadPath = partial?.defaultDownloadPath?.trim() ?? DEFAULT_SETTINGS.defaultDownloadPath;
  if (defaultDownloadPath.toLowerCase() === 'c:\\downloads') {
    defaultDownloadPath = '';
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(partial ?? {}),
    defaultDownloadPath,
    confirmDeletePrompt: partial?.confirmDeletePrompt ?? DEFAULT_SETTINGS.confirmDeletePrompt,
    deleteFileFromDiskDefault: partial?.deleteFileFromDiskDefault ?? DEFAULT_SETTINGS.deleteFileFromDiskDefault,
    autostartEnabled: partial?.autostartEnabled ?? DEFAULT_SETTINGS.autostartEnabled,
    closeToTray: partial?.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
    startMinimized: partial?.startMinimized ?? DEFAULT_SETTINGS.startMinimized,
    speedLimiterMode: partial?.speedLimiterMode ?? DEFAULT_SETTINGS.speedLimiterMode,
    globalSpeedLimitKb: partial?.globalSpeedLimitKb ?? DEFAULT_SETTINGS.globalSpeedLimitKb,
    categorySubfolders: {
      ...DEFAULT_CATEGORY_SUBFOLDERS,
      ...(partial?.categorySubfolders ?? {}),
    },
  };
}

/** Mirrors the backend path resolution for the browser-only fallback preview. */
export function resolveCategoryPathPreview(
  basePath: string,
  category: string,
  filename: string,
  subfolders?: Record<string, string>
): string {
  const base = basePath.trim();
  const raw =
    subfolders?.[category] ??
    DEFAULT_CATEGORY_SUBFOLDERS[category as CategorySubfolderKey] ??
    'General';
  const sub = raw.trim();

  if (!base) {
    return sub ? `${sub}\\${filename}` : filename;
  }
  if (!sub) return `${base}\\${filename}`;
  if (/^[a-zA-Z]:[\\/]/.test(sub) || sub.startsWith('\\\\')) {
    return `${sub.replace(/[\\/]+$/, '')}\\${filename}`;
  }
  return `${base}\\${sub.replace(/^[\\/]+|[\\/]+$/g, '')}\\${filename}`;
}
