import React, { useEffect, useRef, useState } from 'react';
import {
  FileText,
  FolderOpen,
  Copy,
  Check,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  XCircle,
  Trash2,
  FileX,
  Info,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import type { DownloadItem } from '../types/download';
import { truncateFileName, formatBytes } from '../utils/format';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface DownloadContextMenuProps {
  item: DownloadItem;
  position: ContextMenuPosition;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onCopyUrl: (url: string) => void;
  onPauseToggle: (id: string) => void;
  onRedownload: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string, deleteFile?: boolean) => void;
  onViewDetails?: (item: DownloadItem) => void;
  onRefreshLink?: (item: DownloadItem) => void;
  onLimitSpeed?: (item: DownloadItem) => void;
}

export const DownloadContextMenu: React.FC<DownloadContextMenuProps> = ({
  item,
  position,
  onClose,
  onOpenFile,
  onOpenFolder,
  onCopyUrl,
  onPauseToggle,
  onRedownload,
  onCancel,
  onDelete,
  onViewDetails,
  onRefreshLink,
  onLimitSpeed,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Viewport-aware boundary adjustment so menu never spills past screen edges
  const MENU_WIDTH = 230;
  const MENU_HEIGHT = 360;
  const padding = 8;
  const coords = {
    x: typeof window !== 'undefined'
      ? Math.max(padding, Math.min(position.x, window.innerWidth - MENU_WIDTH - padding))
      : position.x,
    y: typeof window !== 'undefined'
      ? Math.max(padding, Math.min(position.y, window.innerHeight - MENU_HEIGHT - padding))
      : position.y,
  };

  // Click outside and scroll/resize dismiss listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleDismissScroll = () => {
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      // Keyboard arrow navigation inside context menu
      if (menuRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const focusableButtons = Array.from(
          menuRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        );
        if (focusableButtons.length === 0) return;

        const currentIndex = focusableButtons.indexOf(document.activeElement as HTMLButtonElement);
        let nextIndex = 0;

        if (event.key === 'ArrowDown') {
          nextIndex = currentIndex >= 0 && currentIndex < focusableButtons.length - 1 ? currentIndex + 1 : 0;
        } else if (event.key === 'ArrowUp') {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : focusableButtons.length - 1;
        }

        focusableButtons[nextIndex]?.focus();
      }
    };

    window.addEventListener('pointerdown', handleClickOutside);
    window.addEventListener('scroll', handleDismissScroll, true);
    window.addEventListener('resize', handleDismissScroll);
    window.addEventListener('keydown', handleKeyDown);

    // Initial focus on first interactive button
    const firstBtn = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstBtn?.focus();

    return () => {
      window.removeEventListener('pointerdown', handleClickOutside);
      window.removeEventListener('scroll', handleDismissScroll, true);
      window.removeEventListener('resize', handleDismissScroll);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleCopyLink = () => {
    onCopyUrl(item.url);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 450);
  };

  const isCompleted = item.status === 'completed';
  const isDownloading = item.status === 'downloading';
  const isQueued = item.status === 'queued';
  const isPaused = item.status === 'paused';
  const isError = item.status === 'error';
  const canCancel = isDownloading || isQueued || isPaused;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Download Actions Menu"
      tabIndex={-1}
      style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
      className="fixed z-50 w-[230px] bg-white border border-[#e5e5e5] rounded-xl shadow-[0_10px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.06)] p-1 text-xs select-none focus:outline-none animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* File Header Metadata */}
      <div className="px-2.5 py-1.5 border-b border-[#e5e5e5] mb-1">
        <div
          className="text-[12px] font-semibold text-[#171717] truncate"
          title={item.fileName}
        >
          {truncateFileName(item.fileName, 26)}
        </div>
        <div className="text-[10px] text-[#737373] flex items-center gap-1.5 font-mono mt-0.5">
          <span>{formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}</span>
          <span>•</span>
          <span className="capitalize">{item.status}</span>
        </div>
      </div>

      {/* Action: View Details */}
      {onViewDetails && (
        <MenuItem
          icon={<Info className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />}
          label="Show Details Panel"
          onClick={() => {
            onViewDetails(item);
            onClose();
          }}
        />
      )}

      {/* Action: Open File */}
      <MenuItem
        icon={<FileText className="w-3.5 h-3.5 stroke-[2]" />}
        label="Open File"
        disabled={!isCompleted}
        onClick={() => {
          onOpenFile(item.destinationPath);
          onClose();
        }}
      />

      {/* Action: Show in Folder */}
      <MenuItem
        icon={<FolderOpen className="w-3.5 h-3.5 stroke-[2]" />}
        label="Show in Folder"
        onClick={() => {
          onOpenFolder(item.destinationPath);
          onClose();
        }}
      />

      {/* Action: Copy URL */}
      <MenuItem
        icon={
          copied ? (
            <Check className="w-3.5 h-3.5 stroke-[2.2] text-[#16a34a]" />
          ) : (
            <Copy className="w-3.5 h-3.5 stroke-[2]" />
          )
        }
        label={copied ? "Copied to Clipboard!" : "Copy Download Link"}
        onClick={handleCopyLink}
      />

      <div className="h-[1px] bg-[#e5e5e5] my-1" role="separator" />

      {/* Action: Pause / Resume / Retry */}
      {isDownloading ? (
        <MenuItem
          icon={<Pause className="w-3.5 h-3.5 stroke-[2.2]" />}
          label="Pause Download"
          onClick={() => {
            onPauseToggle(item.id);
            onClose();
          }}
        />
      ) : isError ? (
        <MenuItem
          icon={<RotateCcw className="w-3.5 h-3.5 stroke-[2.2] text-[#ea580c]" />}
          label="Retry Download"
          onClick={() => {
            onPauseToggle(item.id);
            onClose();
          }}
        />
      ) : isCompleted ? (
        <MenuItem
          icon={<Play className="w-3.5 h-3.5 stroke-[2.2]" />}
          label="Resume Download"
          disabled={true}
          onClick={() => {}}
        />
      ) : (
        <MenuItem
          icon={<Play className="w-3.5 h-3.5 stroke-[2.2] text-[#2563eb]" />}
          label="Resume Download"
          onClick={() => {
            onPauseToggle(item.id);
            onClose();
          }}
        />
      )}

      {/* Action: Redownload from 0 */}
      <MenuItem
        icon={<RotateCw className="w-3.5 h-3.5 stroke-[2]" />}
        label="Redownload from Beginning"
        onClick={() => {
          onRedownload(item.id);
          onClose();
        }}
      />

      {/* Action: Set Speed Limit */}
      {!isCompleted && onLimitSpeed && (
        <MenuItem
          icon={<Gauge className="w-3.5 h-3.5 stroke-[2] text-[#ea580c]" />}
          label={
            item.speedLimitKb && item.speedLimitKb > 0
              ? `Change Speed Limit (${item.speedLimitKb} KB/s)...`
              : 'Set Speed Limit...'
          }
          onClick={() => {
            onLimitSpeed(item);
            onClose();
          }}
        />
      )}

      {/* Action: Refresh Download Address */}
      {onRefreshLink && !isCompleted && (
        <MenuItem
          icon={<RefreshCw className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />}
          label="Refresh Download Address..."
          onClick={() => {
            onRefreshLink(item);
            onClose();
          }}
        />
      )}

      {/* Action: Cancel */}
      {canCancel && (
        <MenuItem
          icon={<XCircle className="w-3.5 h-3.5 stroke-[2] text-[#ea580c]" />}
          label="Cancel Download"
          onClick={() => {
            onCancel(item.id);
            onClose();
          }}
        />
      )}

      <div className="h-[1px] bg-[#e5e5e5] my-1" role="separator" />

      {/* Action: Delete from list */}
      <MenuItem
        icon={<Trash2 className="w-3.5 h-3.5 stroke-[2]" />}
        label="Remove from List"
        tone="danger"
        onClick={() => {
          onDelete(item.id, false);
          onClose();
        }}
      />

      {/* Action: Delete file from disk */}
      <MenuItem
        icon={<FileX className="w-3.5 h-3.5 stroke-[2]" />}
        label="Delete File from Disk"
        tone="danger"
        onClick={() => {
          onDelete(item.id, true);
          onClose();
        }}
      />
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  onClick,
  disabled = false,
  tone = 'normal',
}) => {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[6px] text-left text-[12px] font-medium transition-colors cursor-pointer select-none focus:outline-none ${
        disabled
          ? 'text-[#a3a3a3] cursor-not-allowed opacity-45'
          : tone === 'danger'
          ? 'text-[#737373] hover:text-[#dc2626] hover:bg-red-50 active:bg-red-100/70 focus:bg-red-50 focus:text-[#dc2626]'
          : 'text-[#171717] hover:bg-[#f5f5f5] hover:text-[#0a0a0a] active:bg-[#e5e5e5] focus:bg-[#f5f5f5] focus:text-[#0a0a0a]'
      }`}
    >
      <span
        className={`w-4 h-4 flex items-center justify-center shrink-0 ${
          disabled
            ? 'text-[#a3a3a3]'
            : tone === 'danger'
            ? 'text-[#737373] group-hover:text-[#dc2626]'
            : 'text-[#737373]'
        }`}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
};
