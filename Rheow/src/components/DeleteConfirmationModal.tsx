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
  item: DownloadItem | null;
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

  if (!isOpen || !item) return null;

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
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0 shadow-2xs">
              <Trash2 className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2
                id="delete-dialog-title"
                className="text-sm font-semibold text-[#171717] tracking-tight"
              >
                Delete Download
              </h2>
              <p className="text-[11px] text-[#737373] mt-0.5">
                Confirm download removal
              </p>
            </div>
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
        <div className="p-5 flex flex-col gap-4">
          <p className="text-xs text-[#525252] leading-relaxed">
            Are you sure you want to remove this download from Rheow?
          </p>

          {/* Item Preview Card */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="shrink-0">{getCategoryIcon(item.category)}</span>
                <span
                  className="font-medium text-xs text-[#171717] truncate"
                  title={item.fileName}
                >
                  {truncateFileName(item.fileName, 38)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getCategoryBadgeStyle(
                    item.category
                  )}`}
                >
                  {item.category}
                </span>
                <span className="text-[11px] font-mono text-[#737373]">
                  {formatBytes(item.totalSize || item.downloadedSize)}
                </span>
              </div>
            </div>

            {/* Destination Directory Display */}
            {item.destinationPath && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#e5e5e5] rounded-lg text-[11px] font-mono text-[#525252] truncate"
                title={item.destinationPath}
              >
                <Folder className="w-3.5 h-3.5 text-[#ea580c] shrink-0" />
                <span className="truncate">{item.destinationPath}</span>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="flex flex-col gap-2.5">
            {/* Option 1: Delete file from directory */}
            <label
              className={`flex items-start gap-2.5 p-3 rounded-xl border transition-all cursor-pointer ${
                deleteFile
                  ? 'border-red-200 bg-red-50/40'
                  : 'border-[#e5e5e5] bg-[#fafafa] hover:bg-neutral-100/50'
              }`}
            >
              <input
                type="checkbox"
                checked={deleteFile}
                onChange={(e) => setDeleteFile(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-red-600 focus:ring-red-600 accent-red-600 cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs text-[#171717] block">
                  Also delete file from disk
                </span>
                <span className="text-[11px] text-[#737373] block mt-0.5">
                  Permanently removes the downloaded file from your computer.
                </span>
                {deleteFile && (
                  <div className="flex items-center gap-1 text-[11px] text-red-600 font-medium mt-1.5">
                    <AlertTriangle className="w-3 h-3 stroke-[2.2] shrink-0" />
                    <span>Files cannot be recovered once deleted from disk.</span>
                  </div>
                )}
              </div>
            </label>

            {/* Option 2: Don't show again */}
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-[#e5e5e5] bg-[#fafafa] cursor-pointer hover:bg-neutral-100/50 transition-colors">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-black focus:ring-black accent-[#171717] cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-xs text-[#171717] block">
                  Do not show this confirmation dialog again
                </span>
                <span className="text-[11px] text-[#737373] block mt-0.5">
                  Your choice will be remembered and can be changed in Settings at any time.
                </span>
              </div>
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
            <span>Delete Download</span>
          </button>
        </div>
      </div>
    </div>
  );
};
