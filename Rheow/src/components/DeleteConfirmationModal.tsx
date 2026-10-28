import React, { useState, useEffect } from 'react';
import {
  Trash2,
  X,
  Folder,
  AlertTriangle,
  Archive,
  Terminal,
  Film,
  FileText,
  Music,
  FolderArchive,
} from 'lucide-react';
import type { DownloadItem, DownloadCategory } from '../types/download';
import { formatBytes, truncateFileName } from '../utils/format';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  item?: DownloadItem | null;
  items?: DownloadItem[];
  defaultDeleteFile?: boolean;
  onClose: () => void;
  onConfirm: (deleteFile: boolean, dontShowAgain: boolean) => void;
}

function getCategoryIcon(cat: DownloadCategory) {
  switch (cat) {
    case 'Compressed':
      return <Archive className="w-3.5 h-3.5 text-[#7c3aed] stroke-[2]" />;
    case 'Programs':
      return <Terminal className="w-3.5 h-3.5 text-[#2563eb] stroke-[2]" />;
    case 'Video':
      return <Film className="w-3.5 h-3.5 text-[#ea580c] stroke-[2]" />;
    case 'Documents':
      return <FileText className="w-3.5 h-3.5 text-[#16a34a] stroke-[2]" />;
    case 'Music':
      return <Music className="w-3.5 h-3.5 text-[#0891b2] stroke-[2]" />;
    case 'All':
    default:
      return <FolderArchive className="w-3.5 h-3.5 text-[#171717] stroke-[2]" />;
  }
}

function getCategoryBadgeStyle(cat: DownloadCategory) {
  switch (cat) {
    case 'Compressed':
      return 'bg-[#f3e8ff] text-[#7c3aed]';
    case 'Programs':
      return 'bg-[#dbeaff] text-[#2563eb]';
    case 'Video':
      return 'bg-[#ffedd5] text-[#ea580c]';
    case 'Documents':
      return 'bg-[#dcfce7] text-[#16a34a]';
    case 'Music':
      return 'bg-[#cffafe] text-[#0891b2]';
    default:
      return 'bg-[#f5f5f5] text-[#737373]';
  }
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  item,
  items,
  defaultDeleteFile = false,
  onClose,
  onConfirm,
}) => {
  const [deleteFile, setDeleteFile] = useState(defaultDeleteFile);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDeleteFile(defaultDeleteFile);
      setDontShowAgain(false);
    }
  }, [isOpen, defaultDeleteFile]);

  // Keyboard shortcut: Escape to close, Enter to confirm
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm(deleteFile, dontShowAgain);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, deleteFile, dontShowAgain, onClose, onConfirm]);

  const targetItems = items && items.length > 0 ? items : item ? [item] : [];
  if (!isOpen || targetItems.length === 0) return null;

  const isBulk = targetItems.length > 1;
  const targetCount = targetItems.length;
  const singleItem = !isBulk ? targetItems[0] : null;
  const totalBytes = targetItems.reduce(
    (acc, d) => acc + (d.totalSize || d.downloadedSize || 0),
    0
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[460px] bg-white border border-[#e5e5e5] rounded-[18px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0 shadow-2xs">
              <Trash2 className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h2
              id="delete-dialog-title"
              className="text-sm font-semibold text-[#171717] tracking-tight"
            >
              {isBulk ? `Delete ${targetCount} Downloads` : 'Delete Download'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            title="Cancel (Esc)"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex flex-col gap-3.5">
          <p className="text-xs text-[#525252] leading-relaxed">
            {isBulk
              ? `Are you sure you want to remove ${targetCount} selected downloads from Rheow?`
              : 'Are you sure you want to remove this download from Rheow?'}
          </p>

          {/* Item Preview Card */}
          {isBulk ? (
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#171717]">
                  {targetCount} downloads selected
                </span>
                <span className="text-[11px] font-mono text-[#737373]">
                  Total: {formatBytes(totalBytes)}
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto pr-1 flex flex-col gap-1.5 scrollbar-thin">
                {targetItems.slice(0, 5).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 text-[11px] text-[#525252] min-w-0"
                  >
                    <span className="shrink-0">{getCategoryIcon(d.category)}</span>
                    <span
                      className="truncate flex-1 font-medium text-[#171717]"
                      title={d.fileName}
                    >
                      {truncateFileName(d.fileName, 32)}
                    </span>
                    <span className="font-mono text-[#737373] shrink-0 text-[10px]">
                      {formatBytes(d.totalSize || d.downloadedSize)}
                    </span>
                  </div>
                ))}
                {targetCount > 5 && (
                  <div className="text-[10px] text-[#737373] italic pl-5">
                    and {targetCount - 5} more...
                  </div>
                )}
              </div>
            </div>
          ) : singleItem ? (
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="shrink-0">{getCategoryIcon(singleItem.category)}</span>
                  <span
                    className="font-medium text-xs text-[#171717] truncate"
                    title={singleItem.fileName}
                  >
                    {truncateFileName(singleItem.fileName, 38)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getCategoryBadgeStyle(
                      singleItem.category
                    )}`}
                  >
                    {singleItem.category}
                  </span>
                  <span className="text-[11px] font-mono text-[#737373]">
                    {formatBytes(singleItem.totalSize || singleItem.downloadedSize)}
                  </span>
                </div>
              </div>

              {/* Destination Directory Display */}
              {singleItem.destinationPath && (
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#e5e5e5] rounded-lg text-[11px] font-mono text-[#525252] truncate"
                  title={singleItem.destinationPath}
                >
                  <Folder className="w-3.5 h-3.5 text-[#ea580c] shrink-0" />
                  <span className="truncate">{singleItem.destinationPath}</span>
                </div>
              )}
            </div>
          ) : null}

          {/* Options */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#e5e5e5] overflow-hidden">
            {/* Option 1: Delete file from directory */}
            <label
              className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                deleteFile ? 'bg-red-50/60' : 'hover:bg-neutral-100/50'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <input
                  type="checkbox"
                  checked={deleteFile}
                  onChange={(e) => setDeleteFile(e.target.checked)}
                  className="w-4 h-4 rounded text-red-600 focus:ring-red-600 accent-red-600 cursor-pointer shrink-0"
                />
                <span className="text-xs font-medium text-[#171717] truncate">
                  {isBulk ? 'Also delete files from disk' : 'Also delete file from disk'}
                </span>
              </div>
              {deleteFile && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100/80 border border-red-200/60 shrink-0">
                  <AlertTriangle className="w-3 h-3 stroke-[2.5]" />
                  Permanent
                </span>
              )}
            </label>

            {/* Option 2: Don't show again */}
            <label className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-neutral-100/50 transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer shrink-0"
              />
              <span className="text-xs font-medium text-[#525252]">
                Do not show this confirmation dialog again
              </span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-[#f0f0f0] bg-[#fafafa]/80 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-8.5 px-3.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] font-medium text-xs transition-colors cursor-pointer active:scale-95 shadow-2xs"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => onConfirm(deleteFile, dontShowAgain)}
            className="h-8.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer active:scale-95"
          >
            <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
            <span>{isBulk ? `Delete ${targetCount} Downloads` : 'Delete Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
