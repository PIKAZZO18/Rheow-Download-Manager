import React, { useState, useEffect } from 'react';
import { RheowLogo } from './brand/RheowLogo';
import {
  X,
  FolderOpen,
  Cpu,
  AlertCircle,
  Zap,
  Folder,
  Archive,
  Terminal,
  Film,
  FileText,
  Music,
  RotateCcw,
  Globe,
  RefreshCw,
  Monitor,
  Power,
  Minimize2,
  Gauge,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  type RheowSettings,
  type CategorySubfolderKey,
  CATEGORY_SUBFOLDER_KEYS,
  DEFAULT_CATEGORY_SUBFOLDERS,
  CONNECTION_COUNT_OPTIONS,
  withSettingsDefaults,
} from '../types/settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: RheowSettings;
  onSave: (newSettings: RheowSettings) => void | Promise<void>;
  initialTab?: SettingsTab;
  onOpenBrowserSetup?: () => void;
}

type SettingsTab = 'connection' | 'limiter' | 'storage' | 'engine' | 'browser' | 'desktop';

interface BridgeLastRequest {
  method: string;
  path: string;
  at: string;
}

interface BridgeStatus {
  running: boolean;
  host: string;
  port: number;
  endpoint: string;
  request_count: number;
  extension_connected: boolean;
  last_request: BridgeLastRequest | null;
}

interface BrowserIntegrationStatus {
  bridge: BridgeStatus;
  extension_path: string | null;
  extension_setup_path: string | null;
  extension_version: string | null;
}

const formatBridgeTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const CATEGORY_ICONS: Record<CategorySubfolderKey, React.ReactNode> = {
  Compressed: <Archive className="w-3.5 h-3.5 text-[#7c3aed] stroke-[2] shrink-0" />,
  Programs: <Terminal className="w-3.5 h-3.5 text-[#2563eb] stroke-[2] shrink-0" />,
  Video: <Film className="w-3.5 h-3.5 text-[#ea580c] stroke-[2] shrink-0" />,
  Documents: <FileText className="w-3.5 h-3.5 text-[#16a34a] stroke-[2] shrink-0" />,
  Music: <Music className="w-3.5 h-3.5 text-[#0891b2] stroke-[2] shrink-0" />,
  Other: <Folder className="w-3.5 h-3.5 text-[#737373] stroke-[2] shrink-0" />,
};

// Isolated parallel streams preview so timer ticks do NOT re-render the entire modal
const LivePillsPreview: React.FC<{ maxConnections: number }> = ({ maxConnections }) => {
  const [progress, setProgress] = useState<number>(68);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 98 ? 15 : prev + 1));
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const segments = Array.from({ length: maxConnections }).map((_, idx) => {
    if (progress >= 100) return 100;
    const threadPhase = Math.sin((idx + 1) * 2.399) * 0.7 + Math.cos((idx + 1) * 1.618) * 0.3;
    const damping = Math.sin((progress / 100) * Math.PI);
    const threadDelta = threadPhase * 4.5 * damping;
    return Math.min(100, Math.max(0, Math.round(progress + threadDelta)));
  });

  return (
    <div className="flex items-center gap-1 w-full h-2.5">
      {segments.map((pct, idx) => (
        <div
          key={idx}
          className="flex-1 h-full min-w-[4px] bg-[#e5e5e5]/70 border border-neutral-300/60 rounded-[2.5px] overflow-hidden"
          title={`Part ${idx + 1}: ${pct}%`}
        >
          <div
            className="h-full bg-[#2563eb] rounded-[1px] transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      ))}
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  initialTab,
  onOpenBrowserSetup,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'connection');
  const [localSettings, setLocalSettings] = useState<RheowSettings>(settings);
  const [globalLimitVal, setGlobalLimitVal] = useState<string>('1024');
  const [globalLimitUnit, setGlobalLimitUnit] = useState<'KB/s' | 'MB/s'>('KB/s');
  const [browserStatus, setBrowserStatus] = useState<BrowserIntegrationStatus | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserRefreshKey, setBrowserRefreshKey] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync settings when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
      setSaveError(null);
      setSaving(false);
      if (initialTab) {
        setActiveTab(initialTab);
      }
      if (settings.globalSpeedLimitKb && settings.globalSpeedLimitKb > 0) {
        if (settings.globalSpeedLimitKb >= 1024 && settings.globalSpeedLimitKb % 1024 === 0) {
          setGlobalLimitVal(String(settings.globalSpeedLimitKb / 1024));
          setGlobalLimitUnit('MB/s');
        } else {
          setGlobalLimitVal(String(settings.globalSpeedLimitKb));
          setGlobalLimitUnit('KB/s');
        }
      } else {
        setGlobalLimitVal('1024');
        setGlobalLimitUnit('KB/s');
      }
    }
  }, [isOpen, settings, initialTab]);

  // Read bridge/extension status only when the Browser tab is visible.
  useEffect(() => {
    if (!isOpen || activeTab !== 'browser') return;

    let cancelled = false;
    setBrowserLoading(true);

    invoke<BrowserIntegrationStatus>('get_browser_integration_status')
      .then((status) => {
        if (cancelled) return;
        setBrowserStatus(status);
        setBrowserError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setBrowserStatus(null);
        setBrowserError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBrowserLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, browserRefreshKey]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const bridge = browserStatus?.bridge;
  const bridgeRunning = bridge?.running ?? false;
  const extensionConnected = bridge?.extension_connected ?? false;
  // Prefer the user-writable copy: that is the folder the user must select in
  // "Load unpacked", and it is never locked behind Program Files permissions.
  const extensionPath =
    browserStatus?.extension_setup_path ?? browserStatus?.extension_path ?? null;

  const handleOpenExtensionFolder = async () => {
    try {
      await invoke('open_extension_folder');
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select Default Downloads Folder',
        defaultPath: localSettings.defaultDownloadPath,
      });
      if (selected && typeof selected === 'string') {
        setLocalSettings((prev) => ({ ...prev, defaultDownloadPath: selected }));
      }
    } catch {
      // Fallback in web browser mode
      const manual = prompt('Enter default download folder path:', localSettings.defaultDownloadPath);
      if (manual) {
        setLocalSettings((prev) => ({ ...prev, defaultDownloadPath: manual.trim() }));
      }
    }
  };

  const setCategorySubfolder = (category: CategorySubfolderKey, value: string) => {
    setLocalSettings((prev) => ({
      ...prev,
      categorySubfolders: { ...prev.categorySubfolders, [category]: value },
    }));
  };

  const isInvalidSubfolder = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
    return !isAbsolute && trimmed.split(/[\\/]+/).includes('..');
  };

  const hasInvalidSubfolder = CATEGORY_SUBFOLDER_KEYS.some((category) =>
    isInvalidSubfolder(
      localSettings.categorySubfolders[category] ?? DEFAULT_CATEGORY_SUBFOLDERS[category]
    )
  );

  const handleBrowseCategory = async (category: CategorySubfolderKey) => {
    const current =
      localSettings.categorySubfolders[category] ?? DEFAULT_CATEGORY_SUBFOLDERS[category];
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(current) || current.startsWith('\\\\');
    const suggested = isAbsolute
      ? current
      : [localSettings.defaultDownloadPath, current].filter(Boolean).join('\\');

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: `Select ${category} Downloads Folder`,
        defaultPath: suggested,
      });
      if (selected && typeof selected === 'string') {
        setCategorySubfolder(category, selected);
      }
    } catch {
      // Fallback in web browser mode
      const manual = prompt(`Enter ${category} downloads folder:`, suggested);
      if (manual !== null) {
        setCategorySubfolder(category, manual.trim());
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      await onSave(localSettings);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs select-none"
    >
      {/* Click outside to close backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Settings Modal Window (Firm dimensions with no jump or wobble) */}
      <div className="relative w-full max-w-[680px] max-h-[calc(100vh-24px)] bg-white border border-[#e5e5e5] rounded-[18px] shadow-2xl flex flex-col overflow-hidden z-10">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4.5 py-3 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <RheowLogo variant="tile-light" className="w-7 h-7 rounded-lg shadow-2xs" />
            <h2 className="text-sm font-semibold text-[#171717] tracking-tight">
              Rheow Settings
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            title="Close Settings (Esc)"
            aria-label="Close Settings"
          >
            <X className="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>

        {/* Navigation Tabs (macOS style segmented switch - instant zero-flicker response) */}
        <div className="px-4.5 py-1.5 border-b border-[#f0f0f0] bg-[#fafafa]/60 flex items-center gap-1 shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'connection'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <Zap className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />
            <span>Connection</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('limiter')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'limiter'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <Gauge className="w-3.5 h-3.5 stroke-[2] text-[#d97706]" />
            <span>Speed Limiter</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'storage'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5 stroke-[2] text-[#ea580c]" />
            <span>Save Locations</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'engine'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 stroke-[2] text-[#16a34a]" />
            <span>Engine</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('browser')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'browser'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5 stroke-[2] text-[#7c3aed]" />
            <span>Browser</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('desktop')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'desktop'
                ? 'bg-white text-[#171717] shadow-xs border border-[#e5e5e5] font-semibold'
                : 'text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] border border-transparent'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 stroke-[2] text-[#0891b2]" />
            <span>Desktop</span>
          </button>
        </div>

        {/* Tab Body Content (Consistent stable min-height prevents height jumps and flicker) */}
        <div className="p-4 overflow-y-auto rheow-scrollbar text-xs flex flex-col justify-start">
          {/* TAB 1: CONNECTION */}
          <div className={`space-y-3.5 ${activeTab === 'connection' ? 'block' : 'hidden'}`}>
            {/* Max Connection Selector */}
            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#171717] block">
                  Default Max. Connection Number
                </label>
                <span className="text-[11px] font-mono text-[#737373]">
                  {localSettings.maxConnections} parallel streams
                </span>
              </div>

              {/* Connection Count Buttons */}
              <div className="grid grid-cols-7 gap-1.5">
                {CONNECTION_COUNT_OPTIONS.map((count) => {
                  const isSelected = localSettings.maxConnections === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() =>
                        setLocalSettings((prev) => ({ ...prev, maxConnections: count }))
                      }
                      className={`h-9 rounded-lg flex flex-col items-center justify-center font-mono cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-[#171717] text-white font-bold shadow-xs'
                          : 'bg-white border border-[#e5e5e5] text-[#525252] hover:bg-[#f5f5f5] hover:text-[#171717]'
                      }`}
                    >
                      <span className="text-xs">{count}</span>
                      {count === 8 && (
                        <span
                          className={`text-[8px] font-sans -mt-0.5 ${
                            isSelected ? 'text-neutral-300' : 'text-[#737373]'
                          }`}
                        >
                          Default
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Parallel Visualizer Preview */}
              <div className="pt-2.5 border-t border-[#e5e5e5]/80 space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-[11px] text-[#525252]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-pulse" />
                  <span>Live Preview</span>
                </div>

                <LivePillsPreview maxConnections={localSettings.maxConnections} />
              </div>
            </div>

            {/* Informational Callout */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/60 text-[#92400e] text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <div className="leading-relaxed">
                <strong>Multi-Thread:</strong> Connections are automatically split based on the server's <em>Byte Ranges</em> support without corrupting the file.
              </div>
            </div>
          </div>

          {/* TAB: SPEED LIMITER */}
          <div className={`space-y-3.5 ${activeTab === 'limiter' ? 'block' : 'hidden'}`}>
            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-3.5 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-[#171717] block mb-2">
                  Speed Limiter Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        speedLimiterMode: 'per_download',
                      }))
                    }
                    className={`h-11 px-3.5 rounded-lg border flex items-center justify-between text-xs font-medium cursor-pointer transition-all ${
                      localSettings.speedLimiterMode === 'per_download'
                        ? 'bg-white border-[#2563eb] ring-1 ring-[#2563eb] text-[#171717] shadow-2xs font-semibold'
                        : 'bg-white border-[#e5e5e5] text-[#525252] hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                        localSettings.speedLimiterMode === 'per_download'
                          ? 'bg-blue-50 text-[#2563eb]'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}>
                        <Gauge className="w-3.5 h-3.5 stroke-[2]" />
                      </div>
                      <span>Hero Active (Per-Download)</span>
                    </div>
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      localSettings.speedLimiterMode === 'per_download'
                        ? 'border-[#2563eb] bg-[#2563eb]'
                        : 'border-[#d4d4d4] bg-white'
                    }`}>
                      {localSettings.speedLimiterMode === 'per_download' && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const num = parseFloat(globalLimitVal);
                      const valid = !isNaN(num) && num > 0 ? num : 1024;
                      const kb = globalLimitUnit === 'MB/s' ? Math.round(valid * 1024) : Math.round(valid);
                      setLocalSettings((prev) => ({
                        ...prev,
                        speedLimiterMode: 'global',
                        globalSpeedLimitKb: kb,
                      }));
                    }}
                    className={`h-11 px-3.5 rounded-lg border flex items-center justify-between text-xs font-medium cursor-pointer transition-all ${
                      localSettings.speedLimiterMode === 'global'
                        ? 'bg-white border-[#2563eb] ring-1 ring-[#2563eb] text-[#171717] shadow-2xs font-semibold'
                        : 'bg-white border-[#e5e5e5] text-[#525252] hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                        localSettings.speedLimiterMode === 'global'
                          ? 'bg-blue-50 text-[#2563eb]'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}>
                        <Globe className="w-3.5 h-3.5 stroke-[2]" />
                      </div>
                      <span>Global Speed Limiter</span>
                    </div>
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      localSettings.speedLimiterMode === 'global'
                        ? 'border-[#2563eb] bg-[#2563eb]'
                        : 'border-[#d4d4d4] bg-white'
                    }`}>
                      {localSettings.speedLimiterMode === 'global' && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {/* Detail Section per Mode */}
              {localSettings.speedLimiterMode === 'global' && (
                <div className="pt-3 border-t border-[#e5e5e5] space-y-3 animate-in fade-in duration-150">
                  <label className="text-xs font-semibold text-[#171717] block">
                    Global Speed Limit
                  </label>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="1000000"
                      value={globalLimitVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGlobalLimitVal(val);
                        const num = parseFloat(val);
                        if (!isNaN(num) && num > 0) {
                          const kb = globalLimitUnit === 'MB/s' ? Math.round(num * 1024) : Math.round(num);
                          setLocalSettings((prev) => ({
                            ...prev,
                            globalSpeedLimitKb: kb,
                          }));
                        }
                      }}
                      className="flex-1 bg-white border border-[#e5e5e5] rounded-lg px-3 py-1.5 text-xs text-[#171717] focus:border-[#2563eb] focus:outline-none transition-colors"
                      placeholder="1024"
                    />

                    <div className="flex items-center bg-white border border-[#e5e5e5] rounded-lg p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalLimitUnit('KB/s');
                          const num = parseFloat(globalLimitVal);
                          if (!isNaN(num) && num > 0) {
                            setLocalSettings((prev) => ({
                              ...prev,
                              globalSpeedLimitKb: Math.round(num),
                            }));
                          }
                        }}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          globalLimitUnit === 'KB/s'
                            ? 'bg-[#171717] text-white shadow-2xs font-semibold'
                            : 'text-[#525252] hover:text-[#171717]'
                        }`}
                      >
                        KB/s
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalLimitUnit('MB/s');
                          const num = parseFloat(globalLimitVal);
                          if (!isNaN(num) && num > 0) {
                            setLocalSettings((prev) => ({
                              ...prev,
                              globalSpeedLimitKb: Math.round(num * 1024),
                            }));
                          }
                        }}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          globalLimitUnit === 'MB/s'
                            ? 'bg-[#171717] text-white shadow-2xs font-semibold'
                            : 'text-[#525252] hover:text-[#171717]'
                        }`}
                      >
                        MB/s
                      </button>
                    </div>
                  </div>

                  {/* Quick Presets */}
                  <div>
                    <span className="text-[11px] font-medium text-[#737373] block mb-1.5">
                      Quick Presets:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: '256 KB/s', kb: 256, val: '256', unit: 'KB/s' as const },
                        { label: '500 KB/s', kb: 500, val: '500', unit: 'KB/s' as const },
                        { label: '1 MB/s', kb: 1024, val: '1', unit: 'MB/s' as const },
                        { label: '2 MB/s', kb: 2048, val: '2', unit: 'MB/s' as const },
                        { label: '5 MB/s', kb: 5120, val: '5', unit: 'MB/s' as const },
                        { label: '10 MB/s', kb: 10240, val: '10', unit: 'MB/s' as const },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setGlobalLimitVal(preset.val);
                            setGlobalLimitUnit(preset.unit);
                            setLocalSettings((prev) => ({
                              ...prev,
                              globalSpeedLimitKb: preset.kb,
                            }));
                          }}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                            localSettings.globalSpeedLimitKb === preset.kb
                              ? 'bg-neutral-900 text-white border-neutral-900 shadow-2xs'
                              : 'bg-white border-[#e5e5e5] text-[#525252] hover:text-[#171717] hover:bg-neutral-100'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TAB 2: STORAGE & SAVE LOCATIONS */}
          <div className={`space-y-3.5 ${activeTab === 'storage' ? 'block' : 'hidden'}`}>
            {/* Default Download Directory */}
            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-3.5 space-y-2">
              <label className="text-xs font-semibold text-[#171717] block">
                Default Download Directory
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 h-8.5 px-3 rounded-lg border border-[#e5e5e5] bg-white font-mono text-xs text-[#171717]">
                  <Folder className="w-3.5 h-3.5 text-[#ea580c] shrink-0" />
                  <input
                    type="text"
                    value={localSettings.defaultDownloadPath}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        defaultDownloadPath: e.target.value,
                      }))
                    }
                    placeholder="User Downloads folder (e.g. C:\Users\Username\Downloads)"
                    className="w-full bg-transparent outline-hidden font-mono text-xs text-[#171717]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="h-8.5 px-3.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] font-medium text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-2xs"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>

            {/* Per-category subfolder mapping */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#171717] block px-0.5">
                Category Subfolders
              </label>

              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#e5e5e5] overflow-hidden">
                {CATEGORY_SUBFOLDER_KEYS.map((category) => {
                  const value =
                    localSettings.categorySubfolders[category] ??
                    DEFAULT_CATEGORY_SUBFOLDERS[category];
                  const invalid = isInvalidSubfolder(value);

                  return (
                    <div key={category} className="flex items-center gap-1.5 px-2.5 py-1.5">
                      <span className="w-[96px] shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-[#171717]">
                        {CATEGORY_ICONS[category]}
                        <span className="truncate">{category}</span>
                      </span>

                      <input
                        type="text"
                        value={value}
                        maxLength={260}
                        onChange={(e) => setCategorySubfolder(category, e.target.value)}
                        placeholder="(base folder)"
                        aria-label={`Subfolder ${category}`}
                        aria-invalid={invalid}
                        className={`flex-1 min-w-0 h-7 px-2 rounded-md border bg-white font-mono text-[11px] text-[#171717] outline-hidden ${
                          invalid
                            ? 'border-red-300 focus:border-red-400'
                            : 'border-[#e5e5e5] focus:border-[#a3a3a3]'
                        }`}
                      />

                      <button
                        type="button"
                        onClick={() => handleBrowseCategory(category)}
                        title={`Select ${category} folder`}
                        aria-label={`Select ${category} folder`}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#e5e5e5] transition-colors cursor-pointer shrink-0"
                      >
                        <FolderOpen className="w-3.5 h-3.5 stroke-[2]" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setCategorySubfolder(category, DEFAULT_CATEGORY_SUBFOLDERS[category])
                        }
                        title={`Reset ${category} subfolder`}
                        aria-label={`Reset ${category} subfolder`}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#e5e5e5] transition-colors cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {hasInvalidSubfolder && (
                <p className="text-[11px] leading-relaxed text-red-600">
                  Relative paths cannot contain '..'. Use an absolute folder path instead.
                </p>
              )}
            </div>

            {/* Behavior Preferences Group (Right-aligned switches) */}
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#e5e5e5] overflow-hidden">
              <label className="flex items-center justify-between p-3 cursor-pointer hover:bg-neutral-100/50 transition-colors">
                <span className="font-medium text-xs text-[#171717]">
                  Open Destination Folder on Finish by Default
                </span>
                <input
                  type="checkbox"
                  checked={localSettings.openFolderOnFinishDefault}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      openFolderOnFinishDefault: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 cursor-pointer hover:bg-neutral-100/50 transition-colors">
                <span className="font-medium text-xs text-[#171717]">
                  Confirm Before Deleting Downloads
                </span>
                <input
                  type="checkbox"
                  checked={localSettings.confirmDeletePrompt}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      confirmDeletePrompt: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer"
                />
              </label>

              {!localSettings.confirmDeletePrompt && (
                <label className="flex items-center justify-between p-3 bg-red-50/40 cursor-pointer hover:bg-red-50/70 transition-colors">
                  <span className="font-medium text-xs text-red-900">
                    Delete physical file from disk by default
                  </span>
                  <input
                    type="checkbox"
                    checked={localSettings.deleteFileFromDiskDefault}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        deleteFileFromDiskDefault: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded text-red-600 focus:ring-red-600 accent-red-600 cursor-pointer"
                  />
                </label>
              )}
            </div>
          </div>

          {/* TAB 3: ENGINE & RELIABILITY */}
          <div className={`space-y-3.5 ${activeTab === 'engine' ? 'block' : 'hidden'}`}>
            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-3.5 space-y-3">
              <label className="text-xs font-semibold text-[#171717] block">
                Network Reliability
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#525252] block font-medium">
                    Connection Timeout (seconds)
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={localSettings.connectionTimeoutSeconds}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        connectionTimeoutSeconds: parseInt(e.target.value) || 30,
                      }))
                    }
                    className="w-full h-8.5 px-3 rounded-lg border border-[#e5e5e5] bg-white font-mono text-xs text-[#171717] outline-hidden focus:border-[#2563eb]"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] text-[#525252] block font-medium">
                    Max Retry Attempts
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={localSettings.maxRetries}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        maxRetries: parseInt(e.target.value) || 10,
                      }))
                    }
                    className="w-full h-8.5 px-3 rounded-lg border border-[#e5e5e5] bg-white font-mono text-xs text-[#171717] outline-hidden focus:border-[#2563eb]"
                  />
                </div>
              </div>
            </div>

            {/* Preallocate Disk Space Toggle */}
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] overflow-hidden">
              <label className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-neutral-100/50 transition-colors">
                <span className="font-medium text-xs text-[#171717]">
                  Zero-Fragmentation Pre-allocation (SetEndOfFile)
                </span>
                <input
                  type="checkbox"
                  checked={localSettings.preallocateDiskSpace}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      preallocateDiskSpace: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* TAB 4: BROWSER INTEGRATION */}
          <div className={`space-y-3 ${activeTab === 'browser' ? 'block' : 'hidden'}`}>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200/70 bg-blue-50/60 p-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-white border border-blue-200 flex items-center justify-center text-[#2563eb] shrink-0">
                  <Globe className="w-4 h-4 stroke-[2]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#171717]">Guided browser setup</p>
                  <p className="text-[10px] text-[#737373] leading-relaxed">
                    Opens the extension folder and your browser for you.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenBrowserSetup}
                disabled={!onOpenBrowserSetup}
                className="h-8 px-3 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
              >
                Open wizard
              </button>
            </div>

            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      bridgeRunning ? 'bg-[#16a34a]' : 'bg-[#dc2626]'
                    }`}
                  />
                  <span className="text-xs font-semibold text-[#171717]">Local Bridge</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      bridgeRunning
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}
                  >
                    {browserLoading || (!browserStatus && !browserError)
                      ? 'Checking...'
                      : bridgeRunning
                        ? 'Active'
                        : 'Offline'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBrowserRefreshKey((key) => key + 1)}
                    disabled={browserLoading}
                    title="Refresh bridge status"
                    aria-label="Refresh bridge status"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#e5e5e5] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 stroke-[2] ${browserLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 h-8.5 px-3 rounded-lg border border-[#e5e5e5] bg-white font-mono text-[11px] text-[#171717]">
                <Globe className="w-3.5 h-3.5 text-[#737373] shrink-0" />
                <span className="truncate">
                  {bridge?.endpoint ?? 'http://127.0.0.1:41789'}
                </span>
                <span className="ml-auto text-[10px] text-[#737373] shrink-0">
                  {bridge ? `port ${bridge.port}` : 'port 41789'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-[#737373]">
                <span className="truncate">
                  {bridge && bridge.request_count > 0
                    ? `${bridge.request_count} request${
                        bridge.request_count === 1 ? '' : 's'
                      } received`
                    : 'Waiting for the extension...'}
                </span>
                <span
                  className="font-mono text-[10px] truncate"
                  title={
                    bridge?.last_request
                      ? `${bridge.last_request.method} ${bridge.last_request.path}`
                      : undefined
                  }
                >
                  {bridge?.last_request
                    ? `${bridge.last_request.method} ${
                        bridge.last_request.path
                      } · ${formatBridgeTime(bridge.last_request.at)}`
                    : 'No requests yet'}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#f0f0f0]">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-[#7c3aed] stroke-[2]" />
                  <span className="text-xs font-semibold text-[#171717]">
                    Browser Extension
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      extensionConnected
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-neutral-100 text-[#737373] border-[#e5e5e5]'
                    }`}
                  >
                    {extensionConnected ? 'Connected' : 'Not connected'}
                  </span>
                  <span className="text-[10px] font-mono text-[#737373]">
                    {browserStatus?.extension_version
                      ? `v${browserStatus.extension_version}`
                      : 'Not found'}
                  </span>
                </div>
              </div>

              <div className="px-3 py-2.5 space-y-1.5">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-[#737373]">
                  Extension folder
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 h-7 px-2 rounded-md border border-[#e5e5e5] bg-[#fafafa] font-mono text-[10px] text-[#525252] flex items-center">
                    <span className="truncate" title={extensionPath ?? undefined}>
                      {extensionPath ?? 'Extension folder not found'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenExtensionFolder}
                    disabled={!extensionPath}
                    className="h-7 px-2.5 rounded-md border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <FolderOpen className="w-3.5 h-3.5 stroke-[2]" />
                    <span>Open Folder</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
              <span className="text-xs font-semibold text-[#171717] block">
                Connect the extension
              </span>
              <ol className="space-y-1.5 text-[11px] text-[#525252] leading-relaxed">
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Open <code className="font-mono text-[10px] text-[#171717]">chrome://extensions</code> or{' '}
                    <code className="font-mono text-[10px] text-[#171717]">edge://extensions</code>.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Turn on <strong className="font-semibold text-[#171717]">Developer mode</strong>.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Click <strong className="font-semibold text-[#171717]">Load unpacked</strong> and
                    select the extension folder above.
                  </span>
                </li>
              </ol>
              <p className="text-[10px] text-[#737373] leading-relaxed">
                The bridge only accepts requests from the Rheow extension and rejects normal web
                pages.
              </p>
            </div>

            {browserError && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-50/80 border border-red-200/60 text-red-700 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Status unavailable: {browserError}</span>
              </div>
            )}
          </div>

          {/* TAB 5: DESKTOP INTEGRATION */}
          <div className={`space-y-3.5 ${activeTab === 'desktop' ? 'block' : 'hidden'}`}>
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#e5e5e5] overflow-hidden">
              <label className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-neutral-100/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100/80 flex items-center justify-center text-[#16a34a] shrink-0">
                    <Power className="w-4 h-4 stroke-[2]" />
                  </div>
                  <span className="font-medium text-xs text-[#171717]">
                    Launch Rheow at Windows sign-in
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.autostartEnabled}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      autostartEnabled: e.target.checked,
                      startMinimized: e.target.checked ? prev.startMinimized : false,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer"
                />
              </label>

              <label
                className={`flex items-center justify-between p-3.5 transition-colors ${
                  localSettings.autostartEnabled
                    ? 'cursor-pointer hover:bg-neutral-100/50'
                    : 'cursor-not-allowed opacity-55'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-cyan-50 border border-cyan-100/80 flex items-center justify-center text-[#0891b2] shrink-0">
                    <Minimize2 className="w-4 h-4 stroke-[2]" />
                  </div>
                  <span className="font-medium text-xs text-[#171717]">
                    Start minimized in the tray
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.startMinimized}
                  disabled={!localSettings.autostartEnabled}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      startMinimized: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer disabled:cursor-not-allowed"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-neutral-100/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100/80 flex items-center justify-center text-[#ea580c] shrink-0">
                    <Monitor className="w-4 h-4 stroke-[2]" />
                  </div>
                  <span className="font-medium text-xs text-[#171717]">
                    Keep running when the window is closed
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.closeToTray}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      closeToTray: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer"
                />
              </label>
            </div>

            {!localSettings.closeToTray && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/60 text-[#92400e] text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span>Closing the main window will exit Rheow and stop active downloads.</span>
              </div>
            )}
          </div>
        </div>

        {/* Save feedback stays visible even when the tab body is scrolled */}
        {saveError && (
          <div className="px-4.5 pb-2 shrink-0">
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-50/80 border border-red-200/60 text-red-700 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Could not save settings: {saveError}</span>
            </div>
          </div>
        )}

        {/* Modal Bottom Actions */}
        <div className="flex items-center justify-between px-4.5 py-3 border-t border-[#f0f0f0] bg-white shrink-0">
          <button
            type="button"
            onClick={() => setLocalSettings(withSettingsDefaults())}
            className="text-xs text-[#737373] hover:text-[#171717] hover:underline cursor-pointer"
          >
            Reset to Defaults
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] text-xs font-medium cursor-pointer shadow-2xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={hasInvalidSubfolder || saving}
              className="h-8 px-4 rounded-lg bg-[#171717] hover:bg-black text-white text-xs font-medium cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
