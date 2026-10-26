import React, { useState, useEffect, useRef } from 'react';
import { Disc, Pause, Play, Gauge, Check, FolderOpen, AlertCircle, X, RotateCcw, RefreshCw } from 'lucide-react';
import type { DownloadItem } from '../types/download';
import { truncateFileName, truncateUrl } from '../utils/format';

interface HeroActiveCardProps {
  item?: DownloadItem;
  maxConnections?: number;
  speedLimiterMode?: 'per_download' | 'global';
  globalSpeedLimitKb?: number | null;
  onPauseToggle: (id: string) => void;
  onOpenFolder?: (path: string) => void;
  onLimitSpeedClick?: () => void;
  onOpenFolderToggle?: (id: string, checked: boolean) => void;
  onClose?: () => void;
  onRefreshLink?: (item: DownloadItem) => void;
  onCheckResumeSupport?: (id: string) => Promise<void> | void;
}

/**
 * Ultra-fluid speed hook:
 * Uses requestAnimationFrame with critically-damped exponential easing (lerp)
 * so that live download speeds glide continuously at 60fps rather than stuttering or jumping.
 */
function useFluidSpeed(targetSpeed: number, isDownloading: boolean): string {
  const [animatedSpeed, setAnimatedSpeed] = useState<number>(() => (isDownloading ? targetSpeed : 0));
  const currentSpeedRef = useRef<number>(isDownloading ? targetSpeed : 0);
  const targetSpeedRef = useRef<number>(isDownloading ? targetSpeed : 0);
  const isDownloadingRef = useRef<boolean>(isDownloading);
  const rafIdRef = useRef<number | null>(null);

  targetSpeedRef.current = isDownloading ? targetSpeed : 0;
  isDownloadingRef.current = isDownloading;

  useEffect(() => {
    let lastTime = performance.now();

    const updateFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const target = targetSpeedRef.current;
      const current = currentSpeedRef.current;
      const isDown = isDownloadingRef.current;

      // Exponential smoothing towards target speed
      const diff = target - current;
      if (Math.abs(diff) > 50) {
        // Butter-smooth transition curve
        const lerpFactor = 1 - Math.exp(-9 * dt);
        currentSpeedRef.current = current + diff * lerpFactor;
      } else {
        currentSpeedRef.current = target;
      }

      // Add gentle organic wave (±0.4%) when actively downloading to feel alive and continuous
      let finalDisplaySpeed = currentSpeedRef.current;
      if (isDown && target > 0) {
        const wave = Math.sin(now * 0.0028) * 0.0035 + Math.sin(now * 0.0013) * 0.002;
        finalDisplaySpeed = Math.max(0, currentSpeedRef.current * (1 + wave));
      }

      setAnimatedSpeed(finalDisplaySpeed);

      rafIdRef.current = requestAnimationFrame(updateFrame);
    };

    rafIdRef.current = requestAnimationFrame(updateFrame);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return formatFluidSpeed(animatedSpeed);
}

function formatFluidSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0.00 KB/s';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB/s`;
  }
  const kb = bytesPerSec / 1024;
  if (kb >= 1) {
    return `${kb.toFixed(2)} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

// Safely extract progress percentage from both Rust snake_case and TypeScript camelCase structures
function extractSegmentProgress(seg: any): number {
  if (!seg) return 0;
  if (typeof seg.progress_percentage === 'number') return seg.progress_percentage;
  if (typeof seg.progressPercentage === 'number') return seg.progressPercentage;
  if (typeof seg.percent === 'number') return seg.percent;
  return 0;
}

export const HeroActiveCard: React.FC<HeroActiveCardProps> = ({
  item,
  maxConnections = 8,
  speedLimiterMode = 'per_download',
  globalSpeedLimitKb,
  onPauseToggle,
  onOpenFolder,
  onLimitSpeedClick,
  onOpenFolderToggle,
  onClose,
  onRefreshLink,
  onCheckResumeSupport,
}) => {
  const [isCheckingResume, setIsCheckingResume] = useState(false);
  // If no item is provided, fallback to the design sample
  const currentItem: DownloadItem = item || {
    id: 'demo-hero',
    url: 'https://releases.ubuntu.com/noble/ubuntu-24.04-desktop-amd64.iso',
    category: 'Programs',
    createdAt: new Date().toISOString(),
    fileName: 'ubuntu-24.04-desktop-amd64.iso',
    domain: 'releases.ubuntu.com/noble',
    totalSize: 6_292_307_968, // 5.86 GB
    downloadedSize: 4_273_518_592, // 3.98 GB
    progressPercentage: 68,
    speedBytesPerSecond: 33_764_147, // 32.20 MB/s
    eta: '02m 28s',
    status: 'downloading',
    destinationPath: 'C:\\Downloads\\ISOs\\ubuntu-24.04-desktop-amd64.iso',
    openFolderOnFinish: true,
    segments: [],
  };

  const isDownloading = currentItem.status === 'downloading';
  const isCompleted = currentItem.status === 'completed';
  const isPaused = currentItem.status === 'paused';
  const isCancelled = currentItem.status === 'cancelled';
  const isError = currentItem.status === 'error';
  const progressPercent = Math.round(currentItem.progressPercentage);

  // Hook for ultra-smooth fluid speed display
  const fluidSpeedText = useFluidSpeed(currentItem.speedBytesPerSecond, isDownloading);

  // Determine accent color theme based on status
  const chunkFillColor = isCompleted
    ? 'bg-[#16a34a]'
    : isError || isCancelled
    ? 'bg-[#dc2626]'
    : isPaused
    ? 'bg-[#ea580c]'
    : 'bg-[#2563eb]';

  /**
   * Multi-thread Chunk Segmentation Logic (Parity with IDM & Rheow Reversed Engine):
   * 1. If active download has real segments emitted from Rust Tokio worker threads, use them directly.
   * 2. If fallback or preview, generate exactly `maxConnections` segments (e.g. 8).
   * 3. In IDM, all parts download SIMULTANEOUSLY in parallel from start to finish, NOT one by one.
   *    Each part has its own live progress filling up concurrently, and once all parts reach 100%,
   *    they are assembled into the complete target file.
   */
  const connectionCount =
    currentItem.segments && currentItem.segments.length > 0
      ? currentItem.segments.length
      : maxConnections;

  const segments: { index: number; percent: number }[] =
    currentItem.segments && currentItem.segments.length > 0
      ? currentItem.segments.map((seg: any, idx: number) => ({
          index: idx,
          percent:
            isCompleted || progressPercent >= 100
              ? 100
              : Math.min(100, Math.max(0, Math.round(extractSegmentProgress(seg)))),
        }))
      : Array.from({ length: connectionCount }).map((_, idx: number) => {
          if (isCompleted || progressPercent >= 100) return { index: idx, percent: 100 };
          if (progressPercent <= 0) return { index: idx, percent: 0 };

          // In IDM, all connections advance concurrently with organic TCP bandwidth variance
          const threadPhase = Math.sin((idx + 1) * 2.399) * 0.7 + Math.cos((idx + 1) * 1.618) * 0.3;
          const damping = Math.sin((progressPercent / 100) * Math.PI);
          const threadDelta = threadPhase * 4.5 * damping;
          const calculatedPct = Math.min(100, Math.max(0, Math.round(progressPercent + threadDelta)));

          return {
            index: idx,
            percent: calculatedPct,
          };
        });

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-[16px] p-3 sm:p-3.5 shadow-xs flex flex-col justify-between gap-2.5 sm:gap-3 select-none">
      {/* Featured Header Row */}
      <div className="flex items-center justify-between gap-2">
        {/* File Identity Cluster */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
          <div className="w-8 h-8 rounded-lg bg-[#dbeaff] flex items-center justify-center text-[#2563eb] shrink-0">
            <Disc className="w-[18px] h-[18px] stroke-[2]" />
          </div>

          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {/* Title & Badges */}
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="text-xs sm:text-sm font-semibold text-[#171717] truncate max-w-[200px] sm:max-w-[340px] md:max-w-[480px] lg:max-w-[650px]"
                title={currentItem.fileName}
              >
                {truncateFileName(currentItem.fileName, 50)}
              </span>

              {/* Status Pill Dynamic Theming */}
              {isCompleted ? (
                <span className="bg-[#dcfce7] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#16a34a] whitespace-nowrap">
                    Completed 100%
                  </span>
                </span>
              ) : isPaused ? (
                <span className="bg-[#ffedd5] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ea580c]" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#ea580c] whitespace-nowrap">
                    Paused {progressPercent}%
                  </span>
                </span>
              ) : isCancelled ? (
                <span className="bg-[#fef2f2] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#dc2626] whitespace-nowrap">
                    Cancelled {progressPercent}%
                  </span>
                </span>
              ) : isError ? (
                <span className="bg-[#fee2e2] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <AlertCircle className="w-2.5 h-2.5 text-[#dc2626] stroke-[2.5]" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#dc2626] whitespace-nowrap">
                    Failed {progressPercent}%
                  </span>
                </span>
              ) : isDownloading ? (
                <span className="bg-[#dbeaff] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-pulse" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#1e40af] whitespace-nowrap">
                    Downloading {progressPercent}%
                  </span>
                </span>
              ) : (
                <span className="bg-[#f3e8ff] rounded-full px-[7px] py-[2px] flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed]" />
                  <span className="text-[10px] sm:text-[11px] font-medium text-[#7c3aed] whitespace-nowrap">
                    Queued
                  </span>
                </span>
              )}
            </div>

            {/* Meta Info Line */}
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-[#737373] min-w-0">
              <span className="truncate max-w-[140px] sm:max-w-[240px] md:max-w-[360px]" title={currentItem.domain}>
                {truncateUrl(currentItem.domain, 32)}
              </span>
              <span className="text-[#d4d4d4]">•</span>
              <span className="font-mono text-[#525252] shrink-0">
                {formatBytes(currentItem.downloadedSize)} of {formatBytes(currentItem.totalSize)}
              </span>
              {isDownloading && currentItem.eta && (
                <>
                  <span className="text-[#d4d4d4]">•</span>
                  <span className="text-[#737373] shrink-0">
                    ETA: {currentItem.eta}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Featured Action Buttons (Matches attachment & Pencil layout) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Speed Indicator Pill (Fluid 60fps interpolation & organic breathing) */}
          <div
            className={`flex items-center justify-center px-3 py-[5px] text-xs sm:text-[13px] font-medium rounded-lg select-none transition-all duration-300 shadow-2xs ${
              isDownloading
                ? 'bg-[#e5e5e5] text-[#7c3aed] border border-[#d4d4d4]/60'
                : 'bg-[#f5f5f5] text-[#737373] border border-[#e5e5e5]'
            }`}
            title={`Download Speed: ${fluidSpeedText}`}
          >
            <span>Speed:&nbsp;</span>
            <span className="font-mono tabular-nums font-medium tracking-tight">
              {fluidSpeedText}
            </span>
          </div>

          {isCompleted ? (
            <button
              onClick={() => onOpenFolder?.(currentItem.destinationPath)}
              className="bg-white border border-[#e5e5e5] rounded-lg px-3 py-[5px] flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-medium text-[#171717] hover:bg-[#f5f5f5] active:scale-95 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
            >
              <FolderOpen className="w-3.5 h-3.5 stroke-[2]" />
              <span>Open Folder</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => onPauseToggle(currentItem.id)}
                aria-label={
                  isDownloading
                    ? currentItem.supportsRange === false
                      ? 'Pause download (Warning: Server does not support resume, pausing will restart from 0)'
                      : 'Pause download'
                    : isError
                    ? 'Retry download'
                    : 'Resume download'
                }
                title={
                  isDownloading
                    ? currentItem.supportsRange === false
                      ? 'Pause download (Warning: Server does not support resume, pausing will restart from 0)'
                      : 'Pause download'
                    : isError
                    ? 'Retry download'
                    : 'Resume download'
                }
                className="group relative overflow-hidden flex items-center justify-center gap-1.5 px-3 py-[5px] text-xs sm:text-[13px] font-medium rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white border border-[#2563eb] shadow-xs transition-all duration-300 active:scale-95 cursor-pointer whitespace-nowrap"
              >
                {/* Animated Icon Swap */}
                <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  <Pause
                    className={`w-3.5 h-3.5 absolute inset-0 m-auto transition-all duration-300 ease-out transform stroke-[2.2] text-white ${
                      isDownloading
                        ? 'opacity-100 scale-100 rotate-0'
                        : 'opacity-0 scale-50 rotate-90 pointer-events-none'
                    }`}
                  />
                  <Play
                    className={`w-3.5 h-3.5 absolute inset-0 m-auto transition-all duration-300 ease-out transform fill-current text-white ${
                      isDownloading || isError
                        ? 'opacity-0 scale-50 -rotate-90 pointer-events-none'
                        : 'opacity-100 scale-100 rotate-0'
                    }`}
                  />
                  <RotateCcw
                    className={`w-3.5 h-3.5 absolute inset-0 m-auto transition-all duration-300 ease-out transform stroke-[2.2] text-white ${
                      !isDownloading && isError
                        ? 'opacity-100 scale-100 rotate-0'
                        : 'opacity-0 scale-50 rotate-90 pointer-events-none'
                    }`}
                  />
                </div>

                {/* Animated Text Swap (Mathematically Symmetrical & Centered) */}
                <div className="relative h-4 overflow-hidden w-[50px] sm:w-[56px] select-none flex items-center justify-center">
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-center text-white transition-all duration-300 ease-out transform ${
                      isDownloading
                        ? 'translate-y-0 opacity-100'
                        : '-translate-y-full opacity-0 pointer-events-none'
                    }`}
                  >
                    Pause
                  </span>
                  <span
                    className={`absolute inset-0 flex items-center justify-center text-center text-white transition-all duration-300 ease-out transform ${
                      isDownloading
                        ? 'translate-y-full opacity-0 pointer-events-none'
                        : 'translate-y-0 opacity-100'
                    }`}
                  >
                    {isError ? 'Retry' : 'Resume'}
                  </span>
                </div>
              </button>

              {/* Refresh link button on failed state */}
              {isError && onRefreshLink && (
                <button
                  type="button"
                  onClick={() => onRefreshLink(currentItem)}
                  title="Refresh Download Address"
                  className="bg-white border border-blue-200 hover:border-blue-300 text-[#2563eb] hover:bg-blue-50/70 rounded-lg px-2.5 sm:px-3 py-[5px] flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-medium shadow-2xs active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />
                  <span>Refresh Address</span>
                </button>
              )}
            </>
          )}

          {/* Limit Speed Button (Tangerine styling matching attachment & Pencil) */}
          <button
            onClick={onLimitSpeedClick}
            title={
              speedLimiterMode === 'global'
                ? `Global Speed Limit active (${globalSpeedLimitKb || 0} KB/s). Click to change in Settings.`
                : currentItem.speedLimitKb && currentItem.speedLimitKb > 0
                ? `Speed limit active: ${currentItem.speedLimitKb} KB/s. Click to edit or remove.`
                : 'Set download speed limit (Speed Limiter)'
            }
            className={`border rounded-lg px-2.5 sm:px-3 py-[5px] flex items-center justify-center gap-1.5 text-xs sm:text-[13px] font-medium shadow-xs active:scale-95 transition-all cursor-pointer whitespace-nowrap ${
              speedLimiterMode === 'global'
                ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                : currentItem.speedLimitKb && currentItem.speedLimitKb > 0
                ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600'
                : 'bg-[#ea580c] hover:bg-[#c2410c] text-white border-[#ea580c]'
            }`}
          >
            <Gauge className="w-3.5 h-3.5 stroke-[2] text-white" />
            <span>
              {speedLimiterMode === 'global'
                ? `Global Limit: ${
                    globalSpeedLimitKb && globalSpeedLimitKb >= 1024 && globalSpeedLimitKb % 1024 === 0
                      ? `${globalSpeedLimitKb / 1024} MB/s`
                      : globalSpeedLimitKb
                      ? `${globalSpeedLimitKb} KB/s`
                      : 'Active'
                  }`
                : currentItem.speedLimitKb && currentItem.speedLimitKb > 0
                ? `Limit: ${
                    currentItem.speedLimitKb >= 1024 && currentItem.speedLimitKb % 1024 === 0
                      ? `${currentItem.speedLimitKb / 1024} MB/s`
                      : `${currentItem.speedLimitKb} KB/s`
                  }`
                : 'Limit Speed'}
            </span>
          </button>

          {/* Close/Dismiss Hero Card Button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close card details (Esc)"
              aria-label="Close card details"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] active:scale-90 transition-all border border-transparent hover:border-[#e5e5e5] cursor-pointer shrink-0 ml-0.5"
            >
              <X className="w-3.5 h-3.5 stroke-[2.2]" />
            </button>
          )}
        </div>
      </div>

      {/* Concurrent Segment Visualizer Container (Matches dynamic connection setting) */}
      <div className="flex items-center gap-1 w-full h-3">
        {segments.map((seg, idx) => (
          <div
            key={idx}
            className="flex-1 h-full min-w-[4px] bg-[#f5f5f5] border border-[#e5e5e5] rounded-[3px] overflow-hidden relative group"
            title={`Part ${idx + 1} of ${segments.length}: ${seg.percent}%`}
          >
            <div
              className={`h-full ${chunkFillColor} rounded-[1px] transition-all duration-300`}
              style={{ width: `${seg.percent}%` }}
            />
          </div>
        ))}
      </div>

      {/* Featured Card Bottom */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-[10px] sm:text-[11px]">
        {/* Bottom Left Specs */}
        <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-[#737373] min-w-0 flex-1">
          {isCheckingResume ? (
            <span
              className="bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe] rounded-full px-2 py-[1.5px] text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 shrink-0 shadow-2xs select-none"
              title="Checking resume support with the server..."
            >
              <RefreshCw className="w-2.5 h-2.5 animate-spin text-[#2563eb]" />
              Resume: Checking...
            </span>
          ) : currentItem.supportsRange === false ? (
            <span
              onClick={async () => {
                if (!currentItem.id || isCheckingResume || !onCheckResumeSupport) return;
                setIsCheckingResume(true);
                try {
                  await onCheckResumeSupport(currentItem.id);
                } finally {
                  setTimeout(() => setIsCheckingResume(false), 400);
                }
              }}
              className="bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] rounded-full px-2 py-[1.5px] text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer select-none hover:bg-[#fee2e2] transition-colors"
              title="Server does NOT support resume (HTTP Range). Pausing will restart from 0%. Click to re-check."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />
              Resume: Not Supported
            </span>
          ) : currentItem.supportsRange === true ? (
            <span
              onClick={async () => {
                if (!currentItem.id || isCheckingResume || !onCheckResumeSupport) return;
                setIsCheckingResume(true);
                try {
                  await onCheckResumeSupport(currentItem.id);
                } finally {
                  setTimeout(() => setIsCheckingResume(false), 400);
                }
              }}
              className="bg-[#16a34a] text-white rounded-full px-2 py-[1.5px] text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer select-none hover:bg-[#15803d] transition-colors"
              title="Server supports resume (HTTP Range). File can be paused and resumed at any time. Click to re-check."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Resume: Supported
            </span>
          ) : (
            <span
              onClick={async () => {
                if (!currentItem.id || isCheckingResume || !onCheckResumeSupport) return;
                setIsCheckingResume(true);
                try {
                  await onCheckResumeSupport(currentItem.id);
                } finally {
                  setTimeout(() => setIsCheckingResume(false), 400);
                }
              }}
              className="bg-[#f5f5f5] text-[#737373] border border-[#e5e5e5] rounded-full px-2 py-[1.5px] text-[10px] sm:text-[11px] font-medium flex items-center gap-1.5 shrink-0 cursor-pointer select-none hover:bg-[#e5e5e5] transition-colors"
              title="Resume support status is unknown. Click to check with the server."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#a3a3a3]" />
              Resume: Unknown
            </span>
          )}
          <span className="text-[#d4d4d4]">•</span>
          <span
            className="font-mono truncate max-w-[180px] sm:max-w-[280px] md:max-w-[400px] lg:max-w-[550px] text-[#525252]"
            title={currentItem.destinationPath}
          >
            Save to: {currentItem.destinationPath}
          </span>
        </div>

        {/* Bottom Right Toggles */}
        <div
          onClick={() => onOpenFolderToggle?.(currentItem.id, !currentItem.openFolderOnFinish)}
          className="flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <div
            className={`w-3.5 h-3.5 rounded-[4px] flex items-center justify-center transition-colors ${
              currentItem.openFolderOnFinish
                ? 'bg-[#171717] text-white'
                : 'bg-white border border-[#d4d4d4]'
            }`}
          >
            {currentItem.openFolderOnFinish && (
              <Check className="w-2.5 h-2.5 stroke-[2.5]" />
            )}
          </div>
          <span className="text-[10px] sm:text-[11px] text-[#525252] select-none whitespace-nowrap">
            Open folder on finish
          </span>
        </div>
      </div>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i > 1 ? 2 : 1)} ${units[i]}`;
}
