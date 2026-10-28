import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { downloadDir } from '@tauri-apps/api/path';
import { Check } from 'lucide-react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { HeroActiveCard } from './components/HeroActiveCard';
import { FilterToolbar } from './components/FilterToolbar';
import { DownloadTable } from './components/DownloadTable';
import { DownloadFileInfoModal } from './components/DownloadFileInfoModal';
import { AddUrlModal } from './components/AddUrlModal';
import { BatchAddModal, type BatchItem } from './components/BatchAddModal';
import { SpeedLimiterModal, type SpeedLimiterSettings } from './components/SpeedLimiterModal';
import { SettingsModal } from './components/SettingsModal';
import { BrowserSetupModal } from './components/BrowserSetupModal';
import { DeleteConfirmationModal } from './components/DeleteConfirmationModal';
import { RefreshLinkModal } from './components/RefreshLinkModal';
import { LinkExpiredPromptModal } from './components/LinkExpiredPromptModal';
import { QueueControlBar } from './components/QueueControlBar';
import { SchedulerView } from './components/SchedulerView';
import { SiteGrabberView } from './components/SiteGrabberView';
import { UpdateBanner } from './components/UpdateBanner';
import { UpdateInstallDialog } from './components/UpdateInstallDialog';
import { UpdateNotice } from './components/UpdateNotice';
import { UpdateNotesDialog } from './components/UpdateNotesDialog';
import {
  type RheowSettings,
  type SchedulerSettings,
  type QueueDetails,
  DEFAULT_SCHEDULER_SETTINGS,
  withSettingsDefaults,
} from './types/settings';
import type { UpdateState, UpdateProgress, UpdaterSettings } from './types/updater';
import type { DownloadItem, DownloadCategory, DownloadStatus } from './types/download';

function readLocalSettings(): RheowSettings {
  const saved = localStorage.getItem('rheow_app_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.defaultDownloadPath?.toLowerCase() === 'c:\\downloads') {
        parsed.defaultDownloadPath = '';
      }
      return withSettingsDefaults({
        ...parsed,
        closeToTray: true,
      });
    } catch {}
  }
  return withSettingsDefaults();
}

export function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState('downloads');
  const [selectedCategory, setSelectedCategory] = useState<DownloadCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Download File Info Modal (Specifically for browser downloads via extension)
  const [isDownloadFileInfoOpen, setIsDownloadFileInfoOpen] = useState(false);
  const [downloadFileInfoData, setDownloadFileInfoData] = useState<{
    url?: string;
    filename?: string;
    cookie?: string;
    referer?: string;
  } | null>(null);

  // Add URL Modal
  const [isAddUrlOpen, setIsAddUrlOpen] = useState(false);
  const [isQueueAddMode, setIsQueueAddMode] = useState(false);
  // Batch Add Modal
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false);
  const [batchInitialUrls, setBatchInitialUrls] = useState<string[]>([]);

  // Refresh Download Address & Link Expired Prompt
  const [refreshModalItem, setRefreshModalItem] = useState<DownloadItem | null>(null);
  const [incomingBrowserForRefresh, setIncomingBrowserForRefresh] = useState<{
    url: string;
    filename?: string;
    cookie?: string;
    referer?: string;
  } | null>(null);
  const [expiredPromptItem, setExpiredPromptItem] = useState<DownloadItem | null>(null);
  const [expiredPromptError, setExpiredPromptError] = useState<string | undefined>();

  const refreshModalItemRef = useRef<DownloadItem | null>(null);
  refreshModalItemRef.current = refreshModalItem;

  const downloadsRef = useRef<DownloadItem[]>(downloads);
  downloadsRef.current = downloads;

  const [isSpeedLimiterOpen, setIsSpeedLimiterOpen] = useState(false);
  const [speedLimiterTarget, setSpeedLimiterTarget] = useState<DownloadItem | null>(null);
  const [speedLimiterSettings, setSpeedLimiterSettings] = useState<SpeedLimiterSettings>(() => {
    const saved = localStorage.getItem('rheow_speed_limiter');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      speedLimit: 500,
      unit: 'KBytes/sec',
      alwaysOnStartup: true,
      enabled: false,
    };
  });

  // Browser extension onboarding (shown once after the first launch)
  const [isBrowserSetupOpen, setIsBrowserSetupOpen] = useState(false);

  // App Settings (IDM Connection Count & Engine Preferences)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'connection' | 'limiter' | 'storage' | 'engine' | 'browser' | 'desktop' | 'updates'
  >('connection');
  const [settings, setSettings] = useState<RheowSettings>(readLocalSettings);

  // Auto-update state is owned by Rust; React only mirrors the latest snapshot.
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [areNotesAcknowledged, setAreNotesAcknowledged] = useState(false);

  // Automated Queue Scheduler & Queue Details
  const [schedulerSettings, setSchedulerSettings] = useState<SchedulerSettings>(DEFAULT_SCHEDULER_SETTINGS);
  const [queueDetails, setQueueDetails] = useState<QueueDetails>({
    isRunning: false,
    activeCount: 0,
    queuedCount: 0,
    maxConcurrent: 2,
  });

  // The engine reads its preferences from SQLite. Load them once on startup and
  // migrate the old localStorage-only values the first time.
  useEffect(() => {
    const loadBackendSettings = async () => {
      try {
        const loaded = await invoke<{ settings: RheowSettings; stored: boolean }>('load_settings');
        let effectivePath = loaded.settings.defaultDownloadPath?.trim() || '';

        // If backend path is still empty or legacy C:\Downloads, query OS downloadDir via Tauri path API
        if (!effectivePath || effectivePath.toLowerCase() === 'c:\\downloads') {
          try {
            const osDir = await downloadDir();
            if (osDir) {
              effectivePath = osDir;
            }
          } catch {}
        }

        const effectiveSettings = withSettingsDefaults({
          ...loaded.settings,
          defaultDownloadPath: effectivePath,
          closeToTray: true,
        });

        setSettings(effectiveSettings);
        localStorage.setItem('rheow_app_settings', JSON.stringify(effectiveSettings));

        // If not yet stored in SQLite DB, or if it held the legacy C:\Downloads, persist the user's real downloads directory
        if (!loaded.stored || loaded.settings.defaultDownloadPath?.toLowerCase() === 'c:\\downloads') {
          await invoke('save_settings', { settings: effectiveSettings });
        }
      } catch (e) {
        console.warn('Settings load error:', e);
      }
    };

    const loadSchedulerAndQueue = async () => {
      try {
        const sched = await invoke<SchedulerSettings>('get_scheduler_settings');
        if (sched) {
          setSchedulerSettings(sched);
        }
        const qDetails = await invoke<QueueDetails>('get_queue_details');
        if (qDetails) {
          setQueueDetails((prev) => ({
            ...prev,
            isRunning: qDetails.isRunning,
            maxConcurrent: qDetails.maxConcurrent,
          }));
        }
      } catch (e) {
        console.warn('Scheduler / Queue load error:', e);
      }
    };

    loadBackendSettings();
    loadSchedulerAndQueue();
  }, []);

  // First launch: guide the user through enabling the bundled browser
  // extension. If the extension is already connected (for example on a
  // developer machine), quietly mark onboarding as complete.
  useEffect(() => {
    if (localStorage.getItem('rheow_browser_setup_done') === '1') return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const status = await invoke<{ bridge?: { extension_connected?: boolean } }>(
          'get_browser_integration_status'
        );
        if (cancelled) return;
        if (status.bridge?.extension_connected) {
          localStorage.setItem('rheow_browser_setup_done', '1');
          return;
        }
      } catch {
        // If the check fails, still show the wizard — it explains the setup.
      }

      if (!cancelled) setIsBrowserSetupOpen(true);
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const closeBrowserSetup = () => {
    localStorage.setItem('rheow_browser_setup_done', '1');
    setIsBrowserSetupOpen(false);
  };

  // Toggle Pause All / Resume All
  const [isAllPaused, setIsAllPaused] = useState(false);

  // Load downloads from SQLite on startup
  useEffect(() => {
    loadDownloads();
  }, []);

  const loadDownloads = async () => {
    try {
      const records = await invoke<any[]>('get_all_downloads');
      if (records && records.length > 0) {
        const items: DownloadItem[] = records.map((r) => {
          let domain = 'unknown';
          try {
            domain = new URL(r.url).hostname;
          } catch {}

          const pct = r.total_size > 0 ? (r.downloaded_size / r.total_size) * 100 : 0;

          return {
            id: r.id,
            url: r.url,
            fileName: r.filename,
            category: r.category as DownloadCategory,
            destinationPath: r.destination_path,
            totalSize: r.total_size,
            downloadedSize: r.downloaded_size,
            progressPercentage: pct,
            speedBytesPerSecond: r.speed,
            eta: r.eta_seconds > 0 ? formatEta(r.eta_seconds) : r.status === 'completed' ? 'Finished' : r.status === 'paused' ? 'Paused' : r.status === 'queued' ? 'Queued' : r.status === 'cancelled' ? 'Cancelled' : r.status === 'error' ? 'Failed' : '--:--:--',
            status: r.status as DownloadStatus,
            eTag: r.etag,
            openFolderOnFinish: r.open_folder_on_finish,
            createdAt: r.created_at,
            domain,
            speedLimitKb: r.speed_limit_kb ?? undefined,
            supportsRange: r.supports_range !== undefined ? Boolean(r.supports_range) : true,
            segments: [],
          };
        });

        setDownloads(items);

        // Keep selectedId undefined on initial load so table defaults to expanded state
        // and Hero card stays hidden until the user clicks a task row.
      }
    } catch (e) {
      console.warn('SQLite initial load error:', e);
    }
  };

  // Real-time progress updates from Rust Tokio Engine
  useEffect(() => {
    const unlistenProgressPromise = listen<any>('download-progress', (event) => {
      const payload = event.payload;
      setDownloads((prev) =>
        prev.map((item) => {
          if (item.id === payload.id) {
            return {
              ...item,
              totalSize: payload.total_size > 0 ? payload.total_size : item.totalSize,
              downloadedSize: payload.downloaded_size,
              progressPercentage: payload.progress_percentage,
              speedBytesPerSecond: payload.speed_bytes_per_second,
              eta: payload.eta,
              status: payload.status as DownloadStatus,
              supportsRange: payload.supports_range !== undefined ? payload.supports_range : item.supportsRange,
              segments: payload.segments || [],
            };
          }
          return item;
        })
      );
    });

    const unlistenStatusChangedPromise = listen<any>('download-status-changed', (event) => {
      const { id, status, error, url, supports_range } = event.payload;
      if (status === 'deleted') {
        setDownloads((prev) => prev.filter((item) => item.id !== id));
        setSelectedId((curr) => (curr === id ? undefined : curr));
        return;
      }

      setDownloads((prev) =>
        prev.map((item) => {
          if (item.id === id) {
            const isDone = status === 'completed';
            const isPausedStatus = status === 'paused';
            const isCancelledStatus = status === 'cancelled';
            const isQueuedStatus = status === 'queued';
            const isErrorStatus = status === 'error';

            return {
              ...item,
              url: url || item.url,
              status: status as DownloadStatus,
              supportsRange: supports_range !== undefined ? supports_range : item.supportsRange,
              speedBytesPerSecond: isDone || isPausedStatus || isCancelledStatus || isQueuedStatus || isErrorStatus ? 0 : item.speedBytesPerSecond,
              progressPercentage: isDone ? 100 : item.progressPercentage,
              eta: isDone
                ? 'Finished'
                : isPausedStatus
                ? 'Paused'
                : isCancelledStatus
                ? 'Cancelled'
                : isQueuedStatus
                ? 'Queued'
                : isErrorStatus
                ? 'Failed'
                : item.eta,
            };
          }
          return item;
        })
      );

      // Prompt user to refresh link if a download fails during resume or active flight
      if (status === 'error') {
        const failedItem = downloadsRef.current.find((d: DownloadItem) => d.id === id);
        if (failedItem) {
          setExpiredPromptItem(failedItem);
          setExpiredPromptError(
            error || 'Server rejected the download request (the session link may have expired).'
          );
        }
      }
    });

    const unlistenBrowserAddPromise = listen<any>('browser-add-download', (event) => {
      // If user is currently refreshing a download address, feed the captured payload into the modal
      if (refreshModalItemRef.current) {
        setIncomingBrowserForRefresh(event.payload);
        return;
      }

      setDownloadFileInfoData(event.payload);
      setIsDownloadFileInfoOpen(true);
    });

    const unlistenBrowserBatchPromise = listen<{ urls: string[]; referer?: string }>('browser-add-batch', (event) => {
      if (event.payload?.urls && event.payload.urls.length > 0) {
        setBatchInitialUrls(event.payload.urls);
        setIsBatchAddOpen(true);
      }
    });

    const unlistenTriggerRefreshPromise = listen<string>('trigger-refresh-link', (event) => {
      const downloadId = event.payload;
      const target = downloadsRef.current.find((d: DownloadItem) => d.id === downloadId);
      if (target) {
        setRefreshModalItem(target);
        setExpiredPromptItem(null);
      }
    });

    const unlistenSpeedLimitChangedPromise = listen<{ id: string; speed_limit_kb: number | null }>(
      'download-speed-limit-changed',
      (event) => {
        const { id, speed_limit_kb } = event.payload;
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, speedLimitKb: speed_limit_kb ?? undefined } : item
          )
        );
      }
    );

    const unlistenResumeCheckedPromise = listen<{ id: string; supports_range: boolean }>(
      'download-resume-checked',
      (event) => {
        const { id, supports_range } = event.payload;
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, supportsRange: supports_range } : item
          )
        );
      }
    );

    const unlistenSchedulerPromise = listen<{
      type: string;
      time: string;
      message: string;
    }>('scheduler-event', (event) => {
      if (event.payload?.message) {
        setToastMessage(event.payload.message);
      }
      if (event.payload?.type === 'started') {
        setQueueDetails((prev) => ({ ...prev, isRunning: true }));
      } else if (event.payload?.type === 'stopped' || event.payload?.type === 'all_completed') {
        setQueueDetails((prev) => ({ ...prev, isRunning: false }));
      }
    });

    const unlistenQueueStatusPromise = listen<{
      isRunning?: boolean;
      maxConcurrent?: number;
    }>('queue-status-changed', (event) => {
      setQueueDetails((prev) => ({
        ...prev,
        ...(event.payload.isRunning !== undefined ? { isRunning: event.payload.isRunning } : {}),
        ...(event.payload.maxConcurrent !== undefined ? { maxConcurrent: event.payload.maxConcurrent } : {}),
      }));
    });

    const unlistenSchedulerSettingsPromise = listen<SchedulerSettings>(
      'scheduler-settings-changed',
      (event) => {
        if (event.payload) {
          setSchedulerSettings(event.payload);
        }
      }
    );

    // Expose dev triggers for testing
    (window as any).triggerDownloadFileInfo = (demoData?: any) => {
      setDownloadFileInfoData(
        demoData || {
          url: 'https://releases.ubuntu.com/noble/ubuntu-24.04-desktop-amd64.iso',
          filename: 'ubuntu-24.04-desktop-amd64.iso',
        }
      );
      setIsDownloadFileInfoOpen(true);
    };

    (window as any).triggerBatchAdd = (urls?: string[]) => {
      setBatchInitialUrls(urls || ['https://example.com/file1.zip', 'https://example.com/file2.zip']);
      setIsBatchAddOpen(true);
    };

    (window as any).triggerRefreshLink = (demoItemOrId?: any) => {
      if (typeof demoItemOrId === 'string') {
        const found = downloadsRef.current.find((d: DownloadItem) => d.id === demoItemOrId);
        if (found) {
          setRefreshModalItem(found);
          return;
        }
      } else if (demoItemOrId && typeof demoItemOrId === 'object') {
        setRefreshModalItem(demoItemOrId);
        return;
      }
      if (downloadsRef.current.length > 0) {
        setRefreshModalItem(downloadsRef.current[0]);
      }
    };

    return () => {
      unlistenProgressPromise.then((fn) => fn());
      unlistenStatusChangedPromise.then((fn) => fn());
      unlistenBrowserAddPromise.then((fn) => fn());
      unlistenBrowserBatchPromise.then((fn) => fn());
      unlistenTriggerRefreshPromise.then((fn) => fn());
      unlistenSpeedLimitChangedPromise.then((fn) => fn());
      unlistenResumeCheckedPromise.then((fn) => fn());
      unlistenSchedulerPromise.then((fn) => fn());
      unlistenQueueStatusPromise.then((fn) => fn());
      unlistenSchedulerSettingsPromise.then((fn) => fn());
    };
  }, []);

  // Category counters calculated directly from active downloads
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      All: downloads.length,
      Compressed: 0,
      Programs: 0,
      Video: 0,
      Documents: 0,
      Music: 0,
    };
    downloads.forEach((d) => {
      if (counts[d.category] !== undefined) {
        counts[d.category]++;
      }
    });
    return counts;
  }, [downloads]);

  // Status counters calculated directly from active downloads
  const statusCounts = useMemo(() => {
    const counts = {
      all: downloads.length,
      downloading: 0,
      completed: 0,
      paused: 0,
      queued: 0,
    };
    downloads.forEach((d) => {
      if (d.status === 'downloading') counts.downloading++;
      else if (d.status === 'completed') counts.completed++;
      else if (d.status === 'paused') counts.paused++;
      else if (d.status === 'queued') counts.queued++;
    });
    return counts;
  }, [downloads]);

  // Queued downloads count for Header pill badge
  const queueCount = useMemo(() => {
    return downloads.filter((d) => d.status === 'queued').length;
  }, [downloads]);

  // Filtered downloads for Table
  const filteredDownloads = useMemo(() => {
    return downloads.filter((item) => {
      // If user is on the Queues tab, strictly show queued items
      if (activeTab === 'queues' && item.status !== 'queued') {
        return false;
      }
      // Category filter
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }
      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.fileName.toLowerCase().includes(q);
        const matchUrl = item.url.toLowerCase().includes(q);
        const matchDomain = item.domain.toLowerCase().includes(q);
        if (!matchName && !matchUrl && !matchDomain) return false;
      }
      return true;
    });
  }, [downloads, activeTab, selectedCategory, statusFilter, searchQuery]);

  // A selection only makes sense inside the view it was made in, so reset it
  // whenever the visible set can change underneath the user.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, selectedCategory, statusFilter, searchQuery]);

  // Drop ids that no longer exist (deleted rows) without re-rendering when the
  // selection is already clean.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(downloads.map((d) => d.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (alive.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [downloads]);

  const selectedDownloads = useMemo(
    () => downloads.filter((d) => selectedIds.has(d.id)),
    [downloads, selectedIds]
  );

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    const visibleIds = filteredDownloads.map((d) => d.id);
    setSelectedIds((prev) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      visibleIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  // Active item selected by user from the table
  const activeSelectedItem = downloads.find((d) => d.id === selectedId);  const [cachedHeroItem, setCachedHeroItem] = useState<DownloadItem | undefined>(undefined);

  useEffect(() => {
    if (activeSelectedItem) {
      setCachedHeroItem(activeSelectedItem);
    }
  }, [activeSelectedItem]);

  // Keep showing cached item while exit animation is running to avoid layout flash
  const displayHeroItem = activeSelectedItem || cachedHeroItem;
  const isHeroOpen = Boolean(selectedId && displayHeroItem);

  // Global Esc key listener to deselect and dismiss hero card
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (
          isAddUrlOpen ||
          isSettingsOpen ||
          isBrowserSetupOpen ||
          isSpeedLimiterOpen ||
          isDownloadFileInfoOpen
        ) {
          return;
        }
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
          return;
        }
        if (selectedId) {
          setSelectedId(undefined);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedId,
    selectedIds,
    isAddUrlOpen,
    isSettingsOpen,
    isBrowserSetupOpen,
    isSpeedLimiterOpen,
    isDownloadFileInfoOpen,
  ]);

  const handleStartDownload = async (params: {
    url: string;
    filename: string;
    category: DownloadCategory;
    destinationPath: string;
    totalSize: number;
    segmentCount: number;
    openFolderOnFinish: boolean;
    cookie?: string;
    referer?: string;
    etag?: string;
    lastModified?: string;
    speedLimitKb?: number;
    downloadLater?: boolean;
    supportsRange?: boolean;
    description?: string;
  }) => {
    try {
      let domain = 'unknown';
      try {
        domain = new URL(params.url).hostname;
      } catch {}

      const tempId = await invoke<string>('add_and_start_download', {
        url: params.url,
        filename: params.filename,
        category: params.category,
        destinationPath: params.destinationPath,
        totalSize: params.totalSize,
        segmentCount: params.segmentCount,
        openFolderOnFinish: params.openFolderOnFinish,
        cookie: params.cookie || null,
        referer: params.referer || null,
        etag: params.etag || null,
        lastModified: params.lastModified || null,
        speedLimitKb: params.speedLimitKb || null,
        downloadLater: params.downloadLater || false,
        supportsRange: params.supportsRange !== false,
      });

      const newItem: DownloadItem = {
        id: tempId,
        url: params.url,
        fileName: params.filename,
        category: params.category,
        destinationPath: params.destinationPath,
        totalSize: params.totalSize,
        downloadedSize: 0,
        progressPercentage: 0,
        speedBytesPerSecond: 0,
        eta: params.downloadLater ? 'Queued' : '--:--:--',
        status: params.downloadLater ? 'queued' : 'downloading',
        openFolderOnFinish: params.openFolderOnFinish,
        createdAt: new Date().toISOString(),
        domain,
        speedLimitKb: params.speedLimitKb,
        supportsRange: params.supportsRange !== false,
        segments: [],
      };

      setDownloads((prev) => [newItem, ...prev]);
      if (!params.downloadLater) {
        setSelectedId(tempId);
      }
      if (params.downloadLater) {
        setToastMessage(`'${params.filename}' added to queue`);
      } else {
        setToastMessage(`Download '${params.filename}' started`);
      }
    } catch (err) {
      console.error('Failed to start download:', err);
      setToastMessage(`Failed to add download: ${err}`);
    }
  };

  const handleConfirmBatch = async (items: BatchItem[], startImmediately: boolean) => {
    for (const item of items) {
      try {
        await invoke('add_and_start_download', {
          url: item.url,
          filename: item.filename,
          category: item.category,
          destinationPath: item.destinationPath,
          totalSize: item.totalSize,
          segmentCount: settings.maxConnections,
          openFolderOnFinish: settings.openFolderOnFinishDefault,
          cookie: null,
          referer: null,
          etag: item.etag || null,
          lastModified: item.lastModified || null,
          speedLimitKb: null,
          downloadLater: !startImmediately,
          supportsRange: item.supportsRange !== false,
        });
      } catch (err) {
        console.error('Failed to add item in batch:', item.filename, err);
      }
    }
    await loadDownloads();
    setToastMessage(`Successfully added ${items.length} batch downloads`);
  };

  const handleCheckResumeSupport = async (id: string) => {
    try {
      const isSupported = await invoke<boolean>('check_resume_support', { id });
      setDownloads((prev) =>
        prev.map((item) => (item.id === id ? { ...item, supportsRange: isSupported } : item))
      );
    } catch (err) {
      console.warn('Failed to check resume support:', err);
    }
  };

  const handlePauseToggle = async (id: string) => {
    const item = downloads.find((d) => d.id === id);
    if (!item) return;

    if (item.status === 'downloading') {
      try {
        await invoke('pause_download', { id });
      } catch (err) {
        console.error('Failed to pause download:', err);
      }
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: 'paused', speedBytesPerSecond: 0, eta: 'Paused' } : d))
      );
    } else {
      try {
        await invoke('resume_download', { id });
      } catch (err) {
        console.error('Failed to resume download:', err);
      }
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                status: 'downloading',
                eta: d.eta === 'Paused' || d.eta === 'Queued' || d.eta === 'Finished' || d.eta === 'Cancelled' ? '--:--:--' : d.eta,
              }
            : d
        )
      );
    }
  };

  // Bulk actions run over the current selection. Each item keeps using the
  // same single-item command so queue/cancel semantics stay identical.
  const handleBulkPause = async () => {
    const targets = selectedDownloads.filter(
      (d) => d.status === 'downloading' || d.status === 'queued'
    );
    if (targets.length === 0) return;

    await Promise.allSettled(targets.map((d) => invoke('pause_download', { id: d.id })));
    const ids = new Set(targets.map((d) => d.id));
    setDownloads((prev) =>
      prev.map((d) =>
        ids.has(d.id) ? { ...d, status: 'paused', speedBytesPerSecond: 0, eta: 'Paused' } : d
      )
    );
    setSelectedIds(new Set());
  };

  const handleBulkResume = async () => {
    const targets = selectedDownloads.filter(
      (d) => d.status === 'paused' || d.status === 'error' || d.status === 'cancelled'
    );
    if (targets.length === 0) return;

    // Queue them instead of starting every item at once: the engine's queue
    // worker respects the configured connection limit.
    await invoke('resume_downloads', { ids: targets.map((d) => d.id) }).catch((err) =>
      console.error('Failed to queue selected downloads:', err)
    );
    const ids = new Set(targets.map((d) => d.id));
    setDownloads((prev) =>
      prev.map((d) =>
        ids.has(d.id) ? { ...d, status: 'queued', speedBytesPerSecond: 0, eta: 'Queued' } : d
      )
    );
    setSelectedIds(new Set());
  };

  const handleBulkCancel = async () => {
    const targets = selectedDownloads.filter(
      (d) => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
    );
    if (targets.length === 0) return;

    await Promise.allSettled(targets.map((d) => invoke('cancel_download', { id: d.id })));
    const ids = new Set(targets.map((d) => d.id));
    setDownloads((prev) =>
      prev.map((d) =>
        ids.has(d.id)
          ? { ...d, status: 'cancelled', speedBytesPerSecond: 0, eta: 'Cancelled' }
          : d
      )
    );
    setSelectedIds(new Set());
  };

  const handleCancel = async (id: string) => {
    try {
      await invoke('cancel_download', { id });
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'cancelled', speedBytesPerSecond: 0, eta: 'Cancelled' } : d))
    );
  };

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deleteModalState, setDeleteModalState] = useState<{
    item: DownloadItem;
    initialDeleteFile: boolean;
  } | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Mirror the Rust updater state and throttle-free progress events.
  useEffect(() => {
    let disposed = false;

    const unlistenStatus = listen<UpdateState>('rheow-update-status', (event) => {
      if (!disposed) setUpdateState(event.payload);
    });
    const unlistenProgress = listen<UpdateProgress>('rheow-update-progress', (event) => {
      if (!disposed) {
        setUpdateState((prev) => (prev ? { ...prev, progress: event.payload } : prev));
      }
    });

    invoke<UpdateState>('get_update_state')
      .then((state) => {
        if (!disposed) setUpdateState(state);
      })
      .catch((error) => console.warn('Failed to read update state:', error));

    return () => {
      disposed = true;
      void unlistenStatus.then((unlisten) => unlisten());
      void unlistenProgress.then((unlisten) => unlisten());
    };
  }, []);

  const handleDelete = async (id: string, deleteFile: boolean = false) => {
    try {
      await invoke('delete_download', { id, deleteFile });
      setToastMessage(
        deleteFile
          ? 'Download and file deleted from disk'
          : 'Download removed from list'
      );
    } catch (err) {
      console.error('Failed to delete download:', err);
      setToastMessage('Failed to delete download');
    }
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    if (selectedId === id) {
      setSelectedId(undefined);
    }
    setSelectedIds((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return prev;
    });
  };

  const handleDeleteRequest = (id: string, initialDeleteFile: boolean = false) => {
    const item = downloads.find((d) => d.id === id);
    if (!item) return;

    if (!settings.confirmDeletePrompt) {
      handleDelete(id, settings.deleteFileFromDiskDefault || initialDeleteFile);
      return;
    }

    setDeleteModalState({
      item,
      initialDeleteFile: initialDeleteFile || settings.deleteFileFromDiskDefault,
    });
  };

  const handleConfirmDeleteModal = (deleteFile: boolean, dontShowAgain: boolean) => {
    if (!deleteModalState) return;
    const { id } = deleteModalState.item;

    if (dontShowAgain) {
      const updatedSettings: RheowSettings = {
        ...settings,
        confirmDeletePrompt: false,
        deleteFileFromDiskDefault: deleteFile,
      };
      setSettings(updatedSettings);
      localStorage.setItem('rheow_app_settings', JSON.stringify(updatedSettings));
      invoke('save_settings', { settings: updatedSettings }).catch((e) =>
        console.warn('Failed to save delete preference to engine:', e)
      );
    }

    handleDelete(id, deleteFile);
    setDeleteModalState(null);
  };

  const handleOpenFile = async (path: string) => {
    try {
      await invoke('open_file', { path: path || '' });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  };

  const handleRedownload = async (id: string) => {
    try {
      await invoke('redownload', { id });
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                status: 'queued',
                downloadedSize: 0,
                progressPercentage: 0,
                speedBytesPerSecond: 0,
                eta: 'Queued',
              }
            : d
        )
      );
    } catch (err) {
      console.error('Failed to redownload:', err);
    }
  };

  const handleOpenRefreshModal = (item: DownloadItem) => {
    setRefreshModalItem(item);
    setExpiredPromptItem(null);
  };

  const handleRefreshSuccess = (updatedItem: DownloadItem) => {
    setDownloads((prev) =>
      prev.map((d) =>
        d.id === updatedItem.id
          ? {
              ...d,
              url: updatedItem.url,
              cookie: updatedItem.cookie,
              referer: updatedItem.referer,
              status: 'downloading',
            }
          : d
      )
    );
    setToastMessage(`Download address for '${updatedItem.fileName}' updated! Resuming download...`);
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setToastMessage('Download link copied to clipboard');
    } catch {
      setToastMessage('Failed to copy link');
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke('open_folder', { path: path || '' });
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  const handleTogglePauseResumeAll = async () => {
    const nextState = !isAllPaused;
    setIsAllPaused(nextState);

    if (nextState) {
      // Pause all active downloads
      try {
        await invoke('pause_all_downloads');
      } catch (err) {
        console.error('Failed to pause all downloads:', err);
      }
      setDownloads((prev) =>
        prev.map((d) =>
          d.status === 'downloading'
            ? { ...d, status: 'paused', speedBytesPerSecond: 0, eta: 'Paused' }
            : d
        )
      );
    } else {
      // Resume all paused downloads through queue worker
      try {
        await invoke('resume_all_downloads');
      } catch (err) {
        console.error('Failed to resume all downloads:', err);
      }
      setDownloads((prev) =>
        prev.map((d) =>
          d.status === 'paused' || d.status === 'cancelled'
            ? { ...d, status: 'queued', eta: 'Queued' }
            : d
        )
      );
    }
  };

  // Sync queueDetails counters with downloads state
  useEffect(() => {
    const queued = downloads.filter((d) => d.status === 'queued').length;
    const active = downloads.filter((d) => d.status === 'downloading').length;
    setQueueDetails((prev) => {
      if (prev.queuedCount === queued && prev.activeCount === active) return prev;
      return { ...prev, queuedCount: queued, activeCount: active };
    });
  }, [downloads]);

  const handleStartQueue = async () => {
    try {
      await invoke('start_queue');
      setQueueDetails((prev) => ({ ...prev, isRunning: true }));
      setToastMessage('Download queue started');
    } catch (err) {
      console.error('Failed to start queue:', err);
      setToastMessage('Failed to start download queue');
    }
  };

  const handlePauseQueue = async () => {
    try {
      await invoke('pause_queue');
      setQueueDetails((prev) => ({ ...prev, isRunning: false }));
      setToastMessage('Download queue paused');
    } catch (err) {
      console.error('Failed to pause queue:', err);
      setToastMessage('Failed to pause download queue');
    }
  };

  const handleMaxConcurrentChange = async (count: number) => {
    try {
      await invoke('set_queue_max_concurrent', { count });
      setQueueDetails((prev) => ({ ...prev, maxConcurrent: count }));
      setSchedulerSettings((prev) => ({ ...prev, maxConcurrentQueue: count }));
      setToastMessage(`Queue concurrency set to ${count} files`);
    } catch (err) {
      console.error('Failed to update queue concurrency:', err);
    }
  };

  const handleSaveSchedulerSettings = async (updated: SchedulerSettings) => {
    try {
      await invoke('save_scheduler_settings', { settings: updated });
      setSchedulerSettings(updated);
      setQueueDetails((prev) => ({ ...prev, maxConcurrent: updated.maxConcurrentQueue }));
      setToastMessage('Scheduler settings saved successfully');
    } catch (err) {
      console.error('Failed to save scheduler settings:', err);
      setToastMessage('Failed to save scheduler settings');
    }
  };

  const handleCheckUpdate = async () => {
    try {
      setUpdateState(await invoke<UpdateState>('check_for_update', { manual: true }));
    } catch (err) {
      console.error('Failed to check for updates:', err);
      setToastMessage('Failed to check for updates');
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      setUpdateState(await invoke<UpdateState>('download_update'));
    } catch (err) {
      console.error('Failed to download update:', err);
      setToastMessage('Failed to download the update');
    }
  };

  const handleInstallUpdate = async () => {
    try {
      const next = await invoke<UpdateState>('install_update', { pauseAll: false });
      setUpdateState(next);
      if (next.phase === 'needsPause') {
        setIsUpdateDialogOpen(true);
      }
    } catch (err) {
      console.error('Failed to install update:', err);
      setToastMessage('Failed to start the installer');
    }
  };

  const handleConfirmUpdateInstall = async () => {
    setIsUpdateDialogOpen(false);
    try {
      setUpdateState(await invoke<UpdateState>('install_update', { pauseAll: true }));
    } catch (err) {
      console.error('Failed to install update:', err);
      setToastMessage('Failed to start the installer');
    }
  };

  const handleDismissUpdate = async () => {
    const version = updateState?.info?.version;
    if (!version) return;

    setUpdateState((prev) => (prev ? { ...prev, dismissed: true } : prev));
    try {
      await invoke('dismiss_update', { version });
    } catch (err) {
      console.error('Failed to dismiss update banner:', err);
      setUpdateState((prev) => (prev ? { ...prev, dismissed: false } : prev));
    }
  };

  // Notes are saved before the installer runs. They belong to the version that
  // is running now, so they are shown once and cleared when the user closes them.
  const pendingNotesVersion =
    updateState?.settings.pendingNotesVersion === updateState?.currentVersion
      ? updateState?.settings.pendingNotesVersion
      : null;
  const pendingNotes =
    pendingNotesVersion && !areNotesAcknowledged
      ? updateState?.settings.pendingNotes?.trim() ?? ''
      : '';

  const handleCloseUpdateNotes = () => {
    setAreNotesAcknowledged(true);
    invoke('acknowledge_update_notes').catch((err) =>
      console.error('Failed to clear update notes:', err)
    );
  };

  const handleSaveUpdaterSettings = async (next: UpdaterSettings) => {
    try {
      const saved = await invoke<UpdaterSettings>('save_updater_settings', { settings: next });
      setUpdateState((prev) => (prev ? { ...prev, settings: saved } : prev));
      setToastMessage(
        saved.autoCheck ? 'Automatic update checks enabled' : 'Automatic update checks disabled'
      );
    } catch (err) {
      console.error('Failed to save update settings:', err);
      setToastMessage('Failed to save update settings');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-[#171717] font-sans antialiased">
      {/* Top Navigation Bar */}
      <Header
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === 'settings') {
            setSettingsInitialTab('connection');
            setIsSettingsOpen(true);
          } else {
            setActiveTab(tab);
          }
        }}
        onAddClick={() => {
          setIsQueueAddMode(false);
          setIsAddUrlOpen(true);
        }}
        onAddBatchClick={() => {
          setBatchInitialUrls([]);
          setIsBatchAddOpen(true);
        }}
        isAllPaused={isAllPaused}
        onTogglePauseResumeAll={handleTogglePauseResumeAll}
        queueCount={queueCount}
      />

      {/* Main Layout Container */}
      <div className="flex flex-1 overflow-hidden bg-white">
        {/* Left Sidebar */}
        <Sidebar
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          counts={categoryCounts}
          activeConnections={settings.maxConnections}
        />

        {/* Right Content Area */}
        <main className="flex-1 flex flex-col gap-3 sm:gap-3.5 py-3 sm:py-4 px-3 sm:px-5 pb-3.5 bg-white min-w-0 min-h-0 overflow-hidden">
          {activeTab === 'scheduler' ? (
            <SchedulerView
              settings={schedulerSettings}
              queueDetails={queueDetails}
              queuedDownloads={downloads.filter((d) => d.status === 'queued')}
              onSaveSettings={handleSaveSchedulerSettings}
              onStartQueue={handleStartQueue}
              onPauseQueue={handlePauseQueue}
              onResumeDownload={(id) => handlePauseToggle(id)}
              onCancelDownload={(id) => handleCancel(id)}
              onOpenFolder={(dest) => handleOpenFolder(dest)}
              onOpenAddModal={() => {
                setIsQueueAddMode(true);
                setIsAddUrlOpen(true);
              }}
            />
          ) : activeTab === 'grabber' ? (
            <SiteGrabberView />
          ) : (
            <>
              {/* Update banner: only the dashboard and queue views, never a modal. */}
              {updateState && updateState.info && !updateState.dismissed && (
                <UpdateBanner
                  state={updateState}
                  onInstall={handleInstallUpdate}
                  onDismiss={handleDismissUpdate}
                />
              )}

              {/* Queues Control Bar for Queues tab */}
              {activeTab === 'queues' && (
                <QueueControlBar
                  queueDetails={queueDetails}
                  onStartQueue={handleStartQueue}
                  onPauseQueue={handlePauseQueue}
                  onMaxConcurrentChange={handleMaxConcurrentChange}
                  onAddDownloadClick={() => {
                    setIsQueueAddMode(true);
                    setIsAddUrlOpen(true);
                  }}
                />
              )}

              {/* Collapsible Featured Active Download Card with fluid animation */}
              <div
                className={`grid transition-[grid-template-rows,opacity,margin,transform] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:transform-none ${
                  isHeroOpen
                    ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                    : 'grid-rows-[0fr] opacity-0 -translate-y-2 -mb-3 sm:-mb-3.5 pointer-events-none'
                }`}
                aria-hidden={!isHeroOpen}
              >
                <div className="min-h-0 overflow-hidden">
                  {displayHeroItem && (
                    <div className="pt-0.5 pb-0.5">
                      <HeroActiveCard
                        item={displayHeroItem}
                        maxConnections={settings.maxConnections}
                        speedLimiterMode={settings.speedLimiterMode}
                        globalSpeedLimitKb={settings.globalSpeedLimitKb}
                        onPauseToggle={handlePauseToggle}
                        onOpenFolder={handleOpenFolder}
                        onLimitSpeedClick={() => {
                          if (settings.speedLimiterMode === 'global') {
                            setSettingsInitialTab('limiter');
                            setIsSettingsOpen(true);
                          } else {
                            setSpeedLimiterTarget(displayHeroItem);
                            setIsSpeedLimiterOpen(true);
                          }
                        }}
                        onClose={() => setSelectedId(undefined)}
                        onRefreshLink={handleOpenRefreshModal}
                        onCheckResumeSupport={handleCheckResumeSupport}
                        onOpenFolderToggle={(_id, checked) => {
                          if (displayHeroItem.id) {
                            setDownloads((prev) =>
                              prev.map((d) => (d.id === displayHeroItem.id ? { ...d, openFolderOnFinish: checked } : d))
                            );
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Toolbar Left Cluster (Search & Status Filters) */}
              <FilterToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                counts={statusCounts}
              />

              {/* Downloads Table Card */}
              <DownloadTable
                items={filteredDownloads}
                selectedId={selectedId}
                onSelectItem={(item) => setSelectedId((prev) => (prev === item.id ? undefined : item.id))}
                onViewDetails={(item) => setSelectedId(item.id)}
                onPauseToggle={handlePauseToggle}
                onCancel={handleCancel}
                onOpenFolder={handleOpenFolder}
                onOpenFile={handleOpenFile}
                onRedownload={handleRedownload}
                onRefreshLink={handleOpenRefreshModal}
                onLimitSpeed={(item) => {
                  if (settings.speedLimiterMode === 'global') {
                    setSettingsInitialTab('limiter');
                    setIsSettingsOpen(true);
                  } else {
                    setSpeedLimiterTarget(item);
                    setIsSpeedLimiterOpen(true);
                  }
                }}
                onCopyUrl={handleCopyUrl}
                onDelete={handleDeleteRequest}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                onClearSelection={() => setSelectedIds(new Set())}
                bulkActions={{
                  pause: handleBulkPause,
                  resume: handleBulkResume,
                  cancel: handleBulkCancel,
                  canPause: selectedDownloads.some(
                    (d) => d.status === 'downloading' || d.status === 'queued'
                  ),
                  canResume: selectedDownloads.some(
                    (d) => d.status === 'paused' || d.status === 'error' || d.status === 'cancelled'
                  ),
                  canCancel: selectedDownloads.some(
                    (d) => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
                  ),
                }}
              />
            </>
          )}
        </main>
      </div>

      {/* Download File Info Modal (Specifically for browser downloads via extension) */}
      <DownloadFileInfoModal
        isOpen={isDownloadFileInfoOpen}
        isQueueMode={isQueueAddMode}
        defaultSegmentCount={settings.maxConnections}
        defaultDownloadPath={settings.defaultDownloadPath}
        categorySubfolders={settings.categorySubfolders}
        connectionTimeoutSeconds={settings.connectionTimeoutSeconds}
        openFolderOnFinishDefault={settings.openFolderOnFinishDefault}
        initialData={downloadFileInfoData}
        onClose={() => {
          setIsDownloadFileInfoOpen(false);
          setIsQueueAddMode(false);
          setDownloadFileInfoData(null);
        }}
        onStartDownload={handleStartDownload}
      />

      {/* Add URL Modal (matching Pencil node B6trU) */}
      <AddUrlModal
        isOpen={isAddUrlOpen}
        onClose={() => {
          setIsAddUrlOpen(false);
          setIsQueueAddMode(false);
        }}
        onSubmit={(params) => {
          setIsAddUrlOpen(false);
          setDownloadFileInfoData({
            url: params.url,
          });
          setIsDownloadFileInfoOpen(true);
        }}
      />

      {/* Batch Add Modal */}
      <BatchAddModal
        isOpen={isBatchAddOpen}
        onClose={() => {
          setIsBatchAddOpen(false);
          setBatchInitialUrls([]);
        }}
        initialUrls={batchInitialUrls}
        defaultDownloadPath={settings.defaultDownloadPath}
        categorySubfolders={settings.categorySubfolders}
        connectionTimeoutSeconds={settings.connectionTimeoutSeconds}
        defaultSegmentCount={settings.maxConnections}
        onConfirmBatch={handleConfirmBatch}
      />

      {/* Refresh Download Address Modal (IDM-style link update) */}
      <RefreshLinkModal
        isOpen={Boolean(refreshModalItem)}
        item={refreshModalItem}
        incomingBrowserAdd={incomingBrowserForRefresh}
        onClearIncomingBrowserAdd={() => setIncomingBrowserForRefresh(null)}
        onClose={() => {
          setRefreshModalItem(null);
          setIncomingBrowserForRefresh(null);
        }}
        onSuccess={handleRefreshSuccess}
      />

      {/* Link Expired Alert / Resume Failure Prompt Modal */}
      <LinkExpiredPromptModal
        isOpen={Boolean(expiredPromptItem)}
        item={expiredPromptItem}
        errorMessage={expiredPromptError}
        onRefreshClick={(item) => {
          setExpiredPromptItem(null);
          setRefreshModalItem(item);
        }}
        onRetry={(id) => {
          handlePauseToggle(id);
          setExpiredPromptItem(null);
        }}
        onDismiss={() => {
          setExpiredPromptItem(null);
        }}
      />

      {/* Settings Modal (IDM Connection Count & Engine Preferences) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        initialTab={settingsInitialTab}
        onClose={() => setIsSettingsOpen(false)}
        onOpenBrowserSetup={() => {
          setIsSettingsOpen(false);
          setIsBrowserSetupOpen(true);
        }}
        updateState={updateState}
        onCheckUpdate={handleCheckUpdate}
        onDownloadUpdate={handleDownloadUpdate}
        onInstallUpdate={handleInstallUpdate}
        onSaveUpdaterSettings={handleSaveUpdaterSettings}
        onSave={async (newSettings) => {
          try {
            await invoke('save_settings', { settings: newSettings });
          } catch (error) {
            console.warn('Failed to save settings to engine:', error);
            throw error;
          }
          setSettings(newSettings);
          localStorage.setItem('rheow_app_settings', JSON.stringify(newSettings));
          setToastMessage(
            newSettings.speedLimiterMode === 'global'
              ? `Settings saved. Global limit: ${newSettings.globalSpeedLimitKb || 0} KB/s`
              : 'Settings saved (Hero Active mode)'
          );
        }}
      />

      {/* Shown when the user installs while downloads are still active. */}
      <UpdateInstallDialog
        isOpen={isUpdateDialogOpen}
        state={updateState}
        onClose={() => setIsUpdateDialogOpen(false)}
        onConfirm={handleConfirmUpdateInstall}
      />

      {/* Bottom-right notice for an available release, with its notes. */}
      {updateState?.phase === 'available' &&
        updateState.info &&
        !updateState.dismissed &&
        !isSettingsOpen &&
        !isUpdateDialogOpen &&
        !pendingNotes && (
          <UpdateNotice
            state={updateState}
            onOpen={() => {
              setSettingsInitialTab('updates');
              setIsSettingsOpen(true);
            }}
            onDismiss={handleDismissUpdate}
          />
        )}

      {/* One-time changelog after Rheow restarts on the new version. */}
      <UpdateNotesDialog
        isOpen={Boolean(pendingNotes)}
        version={updateState?.currentVersion ?? ''}
        notes={pendingNotes}
        onClose={handleCloseUpdateNotes}
      />

      {/* First-run browser extension onboarding */}
      <BrowserSetupModal isOpen={isBrowserSetupOpen} onClose={closeBrowserSetup} />

      {/* Speed Limiter Settings Modal (matching Pencil node VsOsl) */}
      <SpeedLimiterModal
        isOpen={isSpeedLimiterOpen}
        initialSettings={
          speedLimiterTarget?.speedLimitKb
            ? {
                speedLimit:
                  speedLimiterTarget.speedLimitKb >= 1024 && speedLimiterTarget.speedLimitKb % 1024 === 0
                    ? speedLimiterTarget.speedLimitKb / 1024
                    : speedLimiterTarget.speedLimitKb,
                unit:
                  speedLimiterTarget.speedLimitKb >= 1024 && speedLimiterTarget.speedLimitKb % 1024 === 0
                    ? 'MBytes/sec'
                    : 'KBytes/sec',
                enabled: true,
              }
            : speedLimiterSettings
        }
        targetFileName={speedLimiterTarget?.fileName}
        hasActiveLimit={!!(speedLimiterTarget?.speedLimitKb && speedLimiterTarget.speedLimitKb > 0)}
        onClose={() => {
          setIsSpeedLimiterOpen(false);
          setSpeedLimiterTarget(null);
        }}
        onApply={async (newSettings, removeLimit) => {
          setSpeedLimiterSettings(newSettings);
          localStorage.setItem('rheow_speed_limiter', JSON.stringify(newSettings));

          const targetId = speedLimiterTarget?.id || selectedId;
          const limitKb = removeLimit
            ? null
            : newSettings.unit === 'MBytes/sec'
            ? Math.round(newSettings.speedLimit * 1024)
            : Math.round(newSettings.speedLimit);

          if (targetId) {
            try {
              await invoke('set_download_speed_limit', {
                id: targetId,
                speedLimitKb: limitKb && limitKb > 0 ? limitKb : null,
              });
              setDownloads((prev) =>
                prev.map((d) =>
                  d.id === targetId ? { ...d, speedLimitKb: limitKb && limitKb > 0 ? limitKb : undefined } : d
                )
              );
              setToastMessage(
                removeLimit
                  ? 'Speed limit removed'
                  : `Speed limit set to ${newSettings.speedLimit} ${newSettings.unit}`
              );
            } catch (err) {
              console.error('Failed to set speed limit:', err);
            }
          }
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={!!deleteModalState}
        item={deleteModalState?.item ?? null}
        defaultDeleteFile={deleteModalState?.initialDeleteFile ?? false}
        onClose={() => setDeleteModalState(null)}
        onConfirm={handleConfirmDeleteModal}
      />

      {/* Floating Copy Feedback Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#171717] text-white text-xs font-medium rounded-full shadow-lg flex items-center gap-2 select-none pointer-events-none"
        >
          <Check className="w-3.5 h-3.5 text-[#16a34a] stroke-[2.5]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

function formatEta(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m`;
  }
  return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}

export default App;
