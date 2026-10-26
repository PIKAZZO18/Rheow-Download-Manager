import React from 'react';
import {
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  X,
  ShieldCheck,
} from 'lucide-react';
import type { DownloadItem } from '../types/download';
import { formatBytes, truncateFileName } from '../utils/format';

export interface LinkExpiredPromptModalProps {
  isOpen: boolean;
  item: DownloadItem | null;
  errorMessage?: string;
  onRefreshClick: (item: DownloadItem) => void;
  onRetry: (id: string) => void;
  onDismiss: () => void;
}

export const LinkExpiredPromptModal: React.FC<LinkExpiredPromptModalProps> = ({
  isOpen,
  item,
  errorMessage,
  onRefreshClick,
  onRetry,
  onDismiss,
}) => {
  if (!isOpen || !item) return null;

  const progressPercent = Math.round(item.progressPercentage || 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className="bg-white border border-[#e5e5e5] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex flex-col w-full max-w-[480px] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e5] bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-2xs">
              <AlertTriangle className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#171717] tracking-tight">
                Link Expired or Server Rejected
              </h2>
              <p className="text-[11px] text-[#737373]">
                Download failed while attempting to resume
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#eaeaea] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3.5">
          {/* File Card */}
          <div className="bg-[#fcfcfc] border border-[#e5e5e5] rounded-xl p-3 space-y-2 shadow-2xs">
            <div className="text-[13px] font-semibold text-[#171717] truncate" title={item.fileName}>
              {truncateFileName(item.fileName, 38)}
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-[#525252]">
              <span>
                {formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}
              </span>
              <span className="font-semibold text-[#2563eb]">{progressPercent}% saved</span>
            </div>
            <div className="w-full h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Error explanation */}
          {errorMessage && (
            <div className="bg-red-50/70 border border-red-200/70 rounded-lg p-2.5 text-[11px] text-red-800 font-mono">
              <span className="font-semibold font-sans">Error message: </span>
              {errorMessage}
            </div>
          )}

          {/* Explanation */}
          <p className="text-[12px] text-[#525252] leading-relaxed">
            File hosting services such as Google Drive often provide temporary download links
            that expire after a few hours.
          </p>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50/70 border border-blue-200/60 text-blue-900 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-[#2563eb] shrink-0" />
            <span>
              You can refresh the download address without losing existing progress ({progressPercent}% preserved).
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#e5e5e5] bg-[#fafafa]">
          <button
            type="button"
            onClick={onDismiss}
            className="px-3.5 py-1.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#525252] text-xs font-medium cursor-pointer shadow-2xs transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onRetry(item.id);
                onDismiss();
              }}
              className="px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Download</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onRefreshClick(item);
                onDismiss();
              }}
              className="px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Address...</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
