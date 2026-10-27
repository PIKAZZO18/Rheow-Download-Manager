import React from 'react';
import { DownloadCloud, X, CheckCircle2 } from 'lucide-react';
import type { UpdateState } from '../types/updater';
import { formatBytes } from '../utils/format';

interface UpdateBannerProps {
  state: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  state,
  onDownload,
  onInstall,
  onDismiss,
}) => {
  const { phase, info, progress } = state;
  if (!info) return null;

  const isDownloading = phase === 'downloading';
  const isReady = phase === 'ready' || phase === 'needsPause';
  const isAvailable = phase === 'available';

  if (!isAvailable && !isDownloading && !isReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 flex items-start sm:items-center gap-3 px-3.5 py-2.5 bg-[#eff6ff] border border-[#bfdbfe] rounded-xl"
    >
      <div className="w-8 h-8 rounded-lg bg-white border border-[#dbeafe] flex items-center justify-center text-[#2563eb] shrink-0">
        {isReady ? (
          <CheckCircle2 className="w-4 h-4 stroke-[2.2]" />
        ) : (
          <DownloadCloud className="w-4 h-4 stroke-[2.2]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#171717] truncate">
            {isReady ? `Rheow ${info.version} is ready to install` : `Rheow ${info.version} is available`}
          </p>
          {isDownloading && (
            <span className="text-[11px] font-mono text-[#2563eb] shrink-0">
              {Math.round(progress?.percent ?? 0)}%
            </span>
          )}
        </div>

        {isDownloading ? (
          <div className="mt-1.5 space-y-1">
            <div className="h-1.5 w-full bg-white/80 border border-[#dbeafe] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2563eb] rounded-full transition-[width] duration-200"
                style={{ width: `${Math.min(100, Math.max(0, progress?.percent ?? 0))}%` }}
              />
            </div>
            <p className="text-[10px] text-[#525252] font-mono">
              {formatBytes(progress?.downloaded ?? 0)}
              {progress?.total ? ` / ${formatBytes(progress.total)}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-[#525252] truncate">
            {isReady
              ? 'Rheow will restart after the installer finishes.'
              : info.notes.trim() || 'A new version is ready to download.'}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isAvailable && (
          <button
            type="button"
            onClick={onDownload}
            className="px-3 py-1.5 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8] cursor-pointer"
          >
            Download
          </button>
        )}
        {isReady && (
          <button
            type="button"
            onClick={onInstall}
            className="px-3 py-1.5 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8] cursor-pointer"
          >
            Install now
          </button>
        )}
        {!isDownloading && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-2.5 py-1.5 rounded-lg text-[#525252] text-xs font-medium hover:bg-white/70 cursor-pointer"
          >
            Later
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-white/70 cursor-pointer"
          aria-label="Dismiss update banner"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
