import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RheowLogo } from './brand/RheowLogo';
import {
  Download,
  Minus,
  Square,
  X,
  Film,
  Archive,
  Terminal,
  FileText,
  Music,
  FolderArchive,
  Lock,
  Copy,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  Tag,
  Clock,
  Loader2,
  Sparkles,
  Layers,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { DownloadCategory } from '../types/download';
import { resolveCategoryPathPreview } from '../types/settings';
import { formatBytes } from '../utils/format';

export interface DownloadFileInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  isQueueMode?: boolean;
  defaultSegmentCount?: number;
  /** Base folder from Settings; the category subfolder is appended by the backend. */
  defaultDownloadPath?: string;
  /** Category -> subfolder/absolute path mapping from Settings. */
  categorySubfolders?: Record<string, string>;
  connectionTimeoutSeconds?: number;
  openFolderOnFinishDefault?: boolean;
  initialData?: {
    url?: string;
    filename?: string;
    cookie?: string;
    referer?: string;
  } | null;
  onStartDownload: (params: {
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
  }) => void;
}

interface ProbeResponse {
  url: string;
  filename: string;
  category: string;
  total_size: number;
  supports_range: boolean;
  etag?: string;
  last_modified?: string;
}

interface CategoryOption {
  id: DownloadCategory;
  label: string;
  typeLabel: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  emblemBg: string;
  emblemBorder: string;
  badgeBg: string;
  badgeBorder: string;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    id: 'Video',
    label: 'Video',
    typeLabel: 'Video Stream',
    icon: Film,
    color: '#ea580c',
    emblemBg: 'bg-[#fff7ed]',
    emblemBorder: 'border-[#fed7aa]',
    badgeBg: 'bg-[#fff7ed]',
    badgeBorder: 'border-[#fed7aa]',
  },
  {
    id: 'Compressed',
    label: 'Compressed',
    typeLabel: 'Compressed Archive',
    icon: Archive,
    color: '#7c3aed',
    emblemBg: 'bg-[#f3e8ff]',
    emblemBorder: 'border-[#e9d5ff]',
    badgeBg: 'bg-[#f3e8ff]',
    badgeBorder: 'border-[#e9d5ff]',
  },
  {
    id: 'Programs',
    label: 'Programs & Apps',
    typeLabel: 'Software / Program',
    icon: Terminal,
    color: '#2563eb',
    emblemBg: 'bg-[#dbeaff]',
    emblemBorder: 'border-[#bfdbfe]',
    badgeBg: 'bg-[#dbeaff]',
    badgeBorder: 'border-[#bfdbfe]',
  },
  {
    id: 'Documents',
    label: 'Documents',
    typeLabel: 'Document File',
    icon: FileText,
    color: '#16a34a',
    emblemBg: 'bg-[#dcfce7]',
    emblemBorder: 'border-[#bbf7d0]',
    badgeBg: 'bg-[#dcfce7]',
    badgeBorder: 'border-[#bbf7d0]',
  },
  {
    id: 'Music',
    label: 'Music & Audio',
    typeLabel: 'Audio Stream',
    icon: Music,
    color: '#0891b2',
    emblemBg: 'bg-[#cffafe]',
    emblemBorder: 'border-[#a5f3fc]',
    badgeBg: 'bg-[#cffafe]',
    badgeBorder: 'border-[#a5f3fc]',
  },
  {
    id: 'Other',
    label: 'Other Files',
    typeLabel: 'Generic File',
    icon: FolderArchive,
    color: '#171717',
    emblemBg: 'bg-[#f5f5f5]',
    emblemBorder: 'border-[#e5e5e5]',
    badgeBg: 'bg-[#f5f5f5]',
    badgeBorder: 'border-[#e5e5e5]',
  },
];

export const DownloadFileInfoModal: React.FC<DownloadFileInfoModalProps> = ({
  isOpen,
  onClose,
  isQueueMode = false,
  defaultSegmentCount = 8,
  defaultDownloadPath = '',
  categorySubfolders,
  connectionTimeoutSeconds = 30,
  openFolderOnFinishDefault = true,
  initialData,
  onStartDownload,
}) => {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState<DownloadCategory>('Video');
  const [destinationPath, setDestinationPath] = useState('');
  const [totalSize, setTotalSize] = useState<number>(0);
  const [supportsRange, setSupportsRange] = useState<boolean>(true);
  const [segmentCount, setSegmentCount] = useState<number>(defaultSegmentCount);
  const [description, setDescription] = useState('');
  const [openFolderOnFinish, setOpenFolderOnFinish] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [probeEtag, setProbeEtag] = useState<string | undefined>();
  const [probeLastModified, setProbeLastModified] = useState<string | undefined>();
  const [sessionCookie, setSessionCookie] = useState<string | undefined>();
  const [sessionReferer, setSessionReferer] = useState<string | undefined>();

  // Custom Category Dropdown State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const updateAutoDestination = useCallback(async (cat: DownloadCategory, fname: string) => {
    const cleanFname = fname.trim() || 'download.bin';
    try {
      const defaultDest = await invoke<string>('get_default_destination', {
        category: cat,
        filename: cleanFname,
        basePath: defaultDownloadPath || null,
        categorySubfolders: categorySubfolders ?? null,
      });
      if (defaultDest) {
        setDestinationPath(defaultDest);
        return;
      }
    } catch {}

    // Safe fallback destination
    setDestinationPath(
      resolveCategoryPathPreview(defaultDownloadPath, cat, cleanFname, categorySubfolders)
    );
  }, [defaultDownloadPath, categorySubfolders]);

  const runProbe = useCallback(async (targetUrl: string, cookie?: string, referer?: string) => {
    if (!targetUrl.trim().startsWith('http://') && !targetUrl.trim().startsWith('https://')) return;

    setIsProbing(true);
    setError(null);
    setSessionCookie(cookie);
    setSessionReferer(referer);

    try {
      const probeRes = await invoke<ProbeResponse>('probe_download', {
        url: targetUrl.trim(),
        cookie: cookie || null,
        referer: referer || null,
        timeoutSeconds: connectionTimeoutSeconds,
      });

      const detectedCat = (probeRes.category as DownloadCategory) || 'Other';
      setFilename(probeRes.filename);
      setCategory(detectedCat);
      setTotalSize(probeRes.total_size);
      setSupportsRange(probeRes.supports_range);
      setProbeEtag(probeRes.etag);
      setProbeLastModified(probeRes.last_modified);

      // Auto resolve destination based on detected category
      await updateAutoDestination(detectedCat, probeRes.filename);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : 'Failed to probe download headers.');
    } finally {
      setIsProbing(false);
    }
  }, [updateAutoDestination, connectionTimeoutSeconds]);

  useEffect(() => {
    if (isOpen) {
      setIsDropdownOpen(false);
      setSegmentCount(defaultSegmentCount);
      if (initialData?.url) {
        setUrl(initialData.url);
        if (initialData.filename) setFilename(initialData.filename);
        setOpenFolderOnFinish(openFolderOnFinishDefault);
        runProbe(initialData.url, initialData.cookie, initialData.referer);
      } else {
        setUrl('');
        setFilename('');
        setDestinationPath('');
        setTotalSize(0);
        setDescription('');
        setError(null);
      }
    }
  }, [isOpen, initialData, runProbe, openFolderOnFinishDefault]);

  if (!isOpen) return null;

  const handleUrlBlur = async () => {
    if (url.trim()) {
      runProbe(url.trim(), sessionCookie, sessionReferer);
    }
  };

  const handleCopyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy URL:', e);
    }
  };

  // Browse Folder with dual-layer support (backend command + plugin-dialog fallback)
  const handleBrowseFolder = async () => {
    try {
      let selectedDir: string | null = null;

      // 1. First try direct backend command
      try {
        const backendRes = await invoke<string | null>('pick_destination_folder');
        if (backendRes) selectedDir = backendRes;
      } catch (e) {
        console.warn('Backend pick_destination_folder error, using openDialog fallback:', e);
      }

      // 2. Fallback to plugin-dialog if not picked
      if (!selectedDir) {
        try {
          const dialogRes = await openDialog({
            directory: true,
            multiple: false,
            title: 'Select Destination Folder',
          });
          if (typeof dialogRes === 'string') {
            selectedDir = dialogRes;
          }
        } catch (e) {
          console.warn('openDialog error:', e);
        }
      }

      if (selectedDir) {
        const fname = filename.trim() || 'download.bin';
        const cleanPath = selectedDir.replace(/[\\/]+$/, '');
        setDestinationPath(`${cleanPath}\\${fname}`);
      }
    } catch (err) {
      console.error('Folder selection failed:', err);
    }
  };

  const handleCategorySelect = (newCat: DownloadCategory) => {
    setCategory(newCat);
    setIsDropdownOpen(false);
    // Automatically update destination folder according to the selected category
    updateAutoDestination(newCat, filename);
  };

  const handleResetToAutoFolder = () => {
    updateAutoDestination(category, filename);
  };

  const handleActionSubmit = (downloadLater: boolean) => {
    if (!url.trim()) return;

    onStartDownload({
      url: url.trim(),
      filename: filename.trim() || 'download.bin',
      category,
      destinationPath: destinationPath.trim(),
      totalSize,
      segmentCount: supportsRange ? segmentCount : 1,
      openFolderOnFinish,
      cookie: sessionCookie,
      referer: sessionReferer,
      etag: probeEtag,
      lastModified: probeLastModified,
      downloadLater,
      supportsRange,
      description: description.trim() || undefined,
    });

    onClose();
  };

  const activeCategoryMeta = CATEGORY_OPTIONS.find((c) => c.id === category) || CATEGORY_OPTIONS[0];
  const ActiveCategoryIcon = activeCategoryMeta.icon;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      {/* Modal Container matching node OhCNW (Rheow - Download File Info) */}
      <div className="w-full max-w-[720px] bg-white border border-[#e5e5e5] rounded-[16px] shadow-[0_16px_32px_rgba(0,0,0,0.12)] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 flex flex-col">
        {/* Window Title Bar (R32Qy) */}
        <div className="h-12 bg-[#f5f5f5] border-b border-[#e5e5e5] px-[18px] flex items-center justify-between shrink-0">
          {/* Title Bar Left (Lo9up) */}
          <div className="flex items-center gap-2.5">
            <RheowLogo variant="tile-light" className="w-6 h-6 rounded-[6px] shadow-2xs shrink-0" />
            <span className="text-[13px] font-semibold text-[#171717]">
              Download File Info
            </span>
            {isQueueMode && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f3e8ff] text-[#7c3aed] border border-[#e9d5ff]">
                Add to Queue
              </span>
            )}
          </div>

          {/* Window Controls (o5vmW2) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              title="Minimize"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] hover:bg-[#e5e5e5] active:scale-95 transition-colors cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <div
              title="Maximize"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] opacity-35 cursor-not-allowed"
            >
              <Square className="w-3 h-3" />
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] hover:bg-red-500 hover:text-white active:scale-95 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Hero File Identity Header (c2Uaf) */}
        <div className="min-h-[70px] bg-white border-b border-[#e5e5e5] px-5 py-3 flex items-center gap-4 shrink-0">
          {/* File Format Emblem (sEmDC) */}
          <div
            className={`w-11 h-11 rounded-[14px] border ${activeCategoryMeta.emblemBg} ${activeCategoryMeta.emblemBorder} flex items-center justify-center shrink-0 shadow-2xs transition-colors`}
          >
            <ActiveCategoryIcon className="w-6 h-6 stroke-[2]" style={{ color: activeCategoryMeta.color }} />
          </div>

          {/* File Info Column (b19hG) */}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            {/* Meta Badges Row (gue9U) */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Type Badge (oKGK5) */}
              <span
                className={`rounded-[6px] px-2 py-0.5 text-[11px] font-semibold border ${activeCategoryMeta.badgeBg} ${activeCategoryMeta.badgeBorder}`}
                style={{ color: activeCategoryMeta.color }}
              >
                {activeCategoryMeta.typeLabel}
              </span>

              {/* Size Badge (Sm82j) */}
              <span className="rounded-[6px] px-2 py-0.5 text-[11px] font-semibold border bg-[#f5f5f5] border-[#e5e5e5] text-[#171717] font-mono">
                {totalSize > 0 ? formatBytes(totalSize) : '3.46 GB'}
              </span>

              {/* Server Status Badge (zqISe) */}
              <span className="rounded-[6px] px-2 py-0.5 text-[11px] font-medium bg-[#dcfce7] text-[#16a34a] flex items-center gap-1.5 border border-[#bbf7d0]/50">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                <span>{supportsRange ? 'Direct Resume Supported' : 'Single Stream Only'}</span>
              </span>
            </div>

            {/* Target Filename (e7hPl0) */}
            <input
              type="text"
              value={filename}
              onChange={(e) => {
                const nextName = e.target.value;
                setFilename(nextName);
                if (destinationPath) {
                  const lastSlash = Math.max(destinationPath.lastIndexOf('\\'), destinationPath.lastIndexOf('/'));
                  if (lastSlash > 0) {
                    const dir = destinationPath.slice(0, lastSlash);
                    setDestinationPath(`${dir}\\${nextName}`);
                  }
                }
              }}
              placeholder="Spider-Man.Brand.New.Day.2026.IMAX.1080p.mkv"
              className="text-[15px] font-semibold text-[#171717] tracking-tight truncate w-full bg-transparent outline-none border-b border-transparent hover:border-[#e5e5e5] focus:border-[#2563eb] transition-colors py-0.5"
              title={filename || 'Enter filename...'}
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-700 flex items-center gap-2">
            <span>{error}</span>
          </div>
        )}

        {/* Form Content Body (N9d2NN) */}
        <div className="px-5 py-4 flex flex-col gap-3.5 bg-white overflow-visible">
          {/* URL Group (V3MAd8) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-[#525252] tracking-wider uppercase">
                SOURCE DOWNLOAD URL
              </label>
              {isProbing && (
                <span className="text-[11px] text-[#2563eb] flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Inspecting headers...
                </span>
              )}
            </div>

            {/* URL Input Box (o7meVE) */}
            <div className="h-10 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg px-3 flex items-center gap-2.5 transition-colors focus-within:border-[#2563eb] focus-within:bg-white">
              <Lock className="w-3.5 h-3.5 text-[#16a34a] shrink-0" />
              <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="https://drive.usercontent.google.com/download?id=1WIoMJ_Gzkb41Qg...&export=download"
                className="w-full bg-transparent text-[11px] font-mono text-[#171717] outline-none truncate"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                title="Copy URL"
                className="bg-white border border-[#e5e5e5] shadow-2xs rounded-[5px] px-2 py-1 text-[10px] font-medium text-[#525252] hover:text-[#171717] hover:border-[#d4d4d4] active:scale-95 transition-all flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-[#16a34a]" />
                ) : (
                  <Copy className="w-3 h-3 text-[#525252]" />
                )}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Category and Destination Row (nqajc) */}
          <div className="grid grid-cols-[185px_1fr] gap-3.5 items-start">
            {/* Category Column (c2dbWc) with Custom Floating Dropdown Menu */}
            <div className="flex flex-col gap-1.5 relative" ref={dropdownRef}>
              <label className="text-[11px] font-semibold text-[#525252] tracking-wider uppercase">
                CATEGORY
              </label>

              {/* Custom Trigger Box (SehCg) */}
              <div
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`h-10 bg-white border rounded-lg px-2.5 flex items-center justify-between cursor-pointer transition-all select-none ${
                  isDropdownOpen
                    ? 'border-[#2563eb] ring-2 ring-[#2563eb]/10 shadow-xs'
                    : 'border-[#e5e5e5] hover:border-[#d4d4d4]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-[22px] h-[22px] rounded-[5px] ${activeCategoryMeta.emblemBg} flex items-center justify-center shrink-0 border ${activeCategoryMeta.emblemBorder}`}
                  >
                    <ActiveCategoryIcon
                      className="w-3.5 h-3.5 stroke-[2]"
                      style={{ color: activeCategoryMeta.color }}
                    />
                  </div>
                  <span className="text-[13px] font-medium text-[#171717] truncate">
                    {activeCategoryMeta.label}
                  </span>
                </div>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-[#737373] shrink-0 transition-transform duration-200 ${
                    isDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </div>

              {/* Custom Dropdown Floating Popover */}
              {isDropdownOpen && (
                <div className="absolute top-[calc(100%+6px)] left-0 w-[215px] bg-white border border-[#e5e5e5] rounded-xl shadow-[0_12px_28px_rgba(0,0,0,0.12)] p-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-semibold text-[#737373] tracking-wider uppercase border-b border-[#f0f0f0] mb-0.5">
                    Select Category
                  </div>

                  {CATEGORY_OPTIONS.map((opt) => {
                    const OptIcon = opt.icon;
                    const isSelected = opt.id === category;

                    return (
                      <div
                        key={opt.id}
                        onClick={() => handleCategorySelect(opt.id)}
                        className={`w-full h-9 px-2 rounded-lg flex items-center justify-between transition-colors cursor-pointer text-xs ${
                          isSelected
                            ? 'bg-[#f5f5f5] text-[#171717] font-semibold'
                            : 'text-[#262626] hover:bg-[#f5f5f5]/80 font-medium'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-6 h-6 rounded-[6px] ${opt.emblemBg} border ${opt.emblemBorder} flex items-center justify-center shrink-0`}
                          >
                            <OptIcon className="w-3.5 h-3.5 stroke-[2]" style={{ color: opt.color }} />
                          </div>
                          <span className="truncate">{opt.label}</span>
                        </div>

                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-[#16a34a] stroke-[2.5] shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save Location Column (Ztpkj) with Auto Preset & Working Browse */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-[#525252] tracking-wider uppercase">
                  SAVE LOCATION
                </label>
                <button
                  type="button"
                  onClick={handleResetToAutoFolder}
                  title="Automatically use default folder based on category type"
                  className="text-[10px] text-[#2563eb] hover:text-[#1d4ed8] hover:underline flex items-center gap-1 font-medium transition-colors cursor-pointer"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Auto (Category Default)</span>
                </button>
              </div>

              {/* Save Input Box (mxjOE) */}
              <div className="h-10 bg-white border border-[#e5e5e5] rounded-lg px-2.5 flex items-center justify-between gap-2 focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/10 transition-all">
                <Folder className="w-[15px] h-[15px] text-[#525252] shrink-0" />
                <input
                  type="text"
                  value={destinationPath}
                  onChange={(e) => setDestinationPath(e.target.value)}
                  placeholder={defaultDownloadPath ? `${defaultDownloadPath}\\Video\\Spider-Man.Brand.New.Day...` : 'Downloads\\Video\\Spider-Man.Brand.New.Day...'}
                  className="w-full bg-transparent text-[11px] font-mono text-[#171717] outline-none truncate"
                  title={destinationPath}
                />
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  title="Choose custom download folder"
                  className="bg-[#f5f5f5] border border-[#e5e5e5] rounded-[6px] px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#171717] hover:bg-[#e5e5e5] active:scale-95 transition-all shadow-2xs cursor-pointer shrink-0"
                >
                  <FolderOpen className="w-3 h-3 stroke-[2]" />
                  <span>Browse...</span>
                </button>
              </div>
            </div>
          </div>

          {/* Parallel Connection Streams & Segment Selection */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 bg-[#fafafa] border border-[#e5e5e5] rounded-xl px-3.5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-white border border-[#e5e5e5] flex items-center justify-center text-[#2563eb] shrink-0 shadow-2xs">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-[#171717]">
                  Parallel Streams
                </span>
                <span className="text-[10px] text-[#737373] truncate">
                  {supportsRange
                    ? `${segmentCount} parallel streams for accelerated download speed`
                    : 'Server does not support range resume (Single stream only)'}
                </span>
              </div>
            </div>

            {supportsRange ? (
              <div className="flex items-center gap-1 bg-white border border-[#e5e5e5] rounded-lg p-0.5 shrink-0">
                {[1, 2, 4, 8, 16, 24, 32].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setSegmentCount(num)}
                    className={`px-2 py-0.5 text-xs font-mono rounded-md transition-all cursor-pointer ${
                      segmentCount === num
                        ? 'bg-[#2563eb] text-white font-semibold shadow-2xs'
                        : 'text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-[11px] font-mono font-medium text-[#737373] bg-white border border-[#e5e5e5] px-2.5 py-1 rounded-md shrink-0">
                1 Stream
              </span>
            )}
          </div>

          {/* Description Group (glRdD) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-[#525252] tracking-wider uppercase">
              DESCRIPTION / DOWNLOAD NOTES (OPTIONAL)
            </label>
            {/* Description Input Box (PO1FY) */}
            <div className="h-[38px] bg-white border border-[#e5e5e5] rounded-lg px-3 flex items-center gap-2 focus-within:border-[#2563eb] transition-colors">
              <Tag className="w-3.5 h-3.5 text-[#737373] shrink-0" />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. 4K IMAX release, Marvel 2026 queue..."
                className="w-full bg-transparent text-xs text-[#171717] placeholder:text-[#a3a3a3] font-normal outline-none"
              />
            </div>
          </div>
        </div>

        {/* Dialog Footer Bar (Fw3Pp) */}
        <div className="h-16 bg-[#f5f5f5] border-t border-[#e5e5e5] px-5 flex items-center justify-between shrink-0 select-none">
          {/* Left: Open Folder Toggle */}
          <div
            onClick={() => setOpenFolderOnFinish(!openFolderOnFinish)}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div
              className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-colors ${
                openFolderOnFinish
                  ? 'bg-[#171717] border-[#171717] text-white'
                  : 'bg-white border-[#d4d4d4] group-hover:border-[#a3a3a3]'
              }`}
            >
              {openFolderOnFinish && <Check className="w-2.5 h-2.5 stroke-[2.5]" />}
            </div>
            <span className="text-[11px] text-[#525252] font-medium group-hover:text-[#171717] transition-colors">
              Open folder on finish
            </span>
          </div>

          {/* Action Buttons Group (Tv6ws) */}
          <div className="h-[38px] flex items-center gap-2.5">
            {/* Cancel Button */}
            <button
              type="button"
              onClick={onClose}
              className="h-full px-4 rounded-lg bg-white border border-[#e5e5e5] text-[#525252] hover:text-[#171717] hover:bg-[#f5f5f5] text-[13px] font-medium flex items-center justify-center active:scale-95 transition-all cursor-pointer"
            >
              Cancel
            </button>

            {isQueueMode ? (
              /* Add to Queue Button: Start Download is removed because item is for the queue */
              <button
                type="button"
                onClick={() => handleActionSubmit(true)}
                className="h-full px-5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add to Queue</span>
              </button>
            ) : (
              <>
                {/* Download Later Button (Fwxch) */}
                <button
                  type="button"
                  onClick={() => handleActionSubmit(true)}
                  className="h-full px-4 rounded-lg bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-[13px] font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Download Later</span>
                </button>

                {/* Start Download Button (AkZZS) */}
                <button
                  type="button"
                  onClick={() => handleActionSubmit(false)}
                  className="h-full px-5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-[13px] font-semibold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Start Download</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
