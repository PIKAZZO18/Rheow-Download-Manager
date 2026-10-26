export type DownloadCategory = 
  | 'All'
  | 'Compressed'
  | 'Programs'
  | 'Video'
  | 'Documents'
  | 'Music'
  | 'Other';

export type DownloadStatus = 
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'queued'
  | 'cancelled'
  | 'error';

export interface DownloadSegment {
  id: number;
  segmentIndex: number;
  startOffset: number;
  endOffset: number;
  currentOffset: number;
  isCompleted: boolean;
  progressPercentage: number;
}

export interface DownloadItem {
  id: string;
  url: string;
  fileName: string;
  category: DownloadCategory;
  destinationPath: string;
  totalSize: number;
  downloadedSize: number;
  progressPercentage: number;
  speedBytesPerSecond: number;
  eta: string;
  status: DownloadStatus;
  eTag?: string;
  openFolderOnFinish: boolean;
  createdAt: string;
  domain: string;
  cookie?: string;
  referer?: string;
  lastModified?: string;
  speedLimitKb?: number;
  segmentCount?: number;
  supportsRange?: boolean;
  segments: DownloadSegment[];
}

export interface SystemDiskInfo {
  driveLetter: string;
  freeBytes: number;
  totalBytes: number;
  usedBytes: number;
  activeConnections: number;
}
