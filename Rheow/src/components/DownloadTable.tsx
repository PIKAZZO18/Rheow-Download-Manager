import React, { useState, useMemo } from 'react';
import {
  FolderArchive,
  Archive,
  Terminal,
  Film,
  FileText,
  Music,
  Pause,
  Play,
  FolderOpen,
  Trash2,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Timer,
  AlertCircle,
  XCircle,
  RotateCcw,
  Minus,
  X,
  RefreshCw,
} from 'lucide-react';
import type { DownloadItem, DownloadCategory } from '../types/download';
import { truncateFileName, truncateUrl, formatBytes } from '../utils/format';
import { DownloadContextMenu } from './DownloadContextMenu';

export type SortField = 'name' | 'category' | 'size' | 'speed' | 'timeLeft' | 'status';
export type SortDirection = 'asc' | 'desc';

const parseEtaToSeconds = (eta: string): number => {
  if (!eta || eta === '--:--:--') return 99999999;
  if (eta === 'Finished') return 0;
  if (eta === 'Paused') return 99999990;
  if (eta === 'Queued') return 99999995;
  if (eta === 'Failed' || eta === 'Cancelled') return 99999999;

  let total = 0;
  const hMatch = eta.match(/(\d+)\s*h/);
  const mMatch = eta.match(/(\d+)\s*m/);
  const sMatch = eta.match(/(\d+)\s*s/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  if (sMatch) total += parseInt(sMatch[1], 10);
  return total > 0 ? total : 99999999;
};

const STATUS_ORDER: Record<string, number> = {
  downloading: 1,
  queued: 2,
  paused: 3,
  completed: 4,
  error: 5,
  cancelled: 6,
};

interface BulkActions {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
}

interface DownloadTableProps {
  items: DownloadItem[];
  selectedId?: string;
  onSelectItem: (item: DownloadItem) => void;
  onViewDetails?: (item: DownloadItem) => void;
  onPauseToggle: (id: string) => void;
  onCancel?: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onDelete: (id: string, deleteFile?: boolean) => void;
  onRedownload?: (id: string) => void;
  onRefreshLink?: (item: DownloadItem) => void;
  onLimitSpeed?: (item: DownloadItem) => void;
  onCopyUrl?: (url: string) => void;
  onStatusClick?: (id: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onClearSelection?: () => void;
  bulkActions?: BulkActions;
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  items,
  selectedId,
  onSelectItem,
  onViewDetails,
  onPauseToggle,
  onCancel,
  onOpenFolder,
  onOpenFile,
  onDelete,
  onRedownload,
  onRefreshLink,
  onLimitSpeed,
  onCopyUrl,
  onStatusClick,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onClearSelection,
  bulkActions,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    item: DownloadItem;
    position: { x: number; y: number };
  } | null>(null);

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field);
      // Sensible defaults: size & speed default to desc (users usually look for largest/fastest)
      setSortDirection(field === 'size' || field === 'speed' ? 'desc' : 'asc');
    } else {
      const defaultDir: SortDirection = field === 'size' || field === 'speed' ? 'desc' : 'asc';
      if (sortDirection === defaultDir) {
        // 2nd click: toggle direction
        setSortDirection(defaultDir === 'asc' ? 'desc' : 'asc');
      } else {
        // 3rd click: reset to default natural creation order
        setSortField(null);
      }
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortField) return items;

    return [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base', numeric: true });
          break;
        case 'category':
          cmp = a.category.localeCompare(b.category);
          break;
        case 'size': {
          const sizeA = a.totalSize > 0 ? a.totalSize : 0;
          const sizeB = b.totalSize > 0 ? b.totalSize : 0;
          cmp = sizeA - sizeB;
          if (cmp === 0) {
            cmp = a.downloadedSize - b.downloadedSize;
          }
          break;
        }
        case 'speed':
          cmp = a.speedBytesPerSecond - b.speedBytesPerSecond;
          break;
        case 'timeLeft':
          cmp = parseEtaToSeconds(a.eta) - parseEtaToSeconds(b.eta);
          break;
        case 'status': {
          const orderA = STATUS_ORDER[a.status] ?? 99;
          const orderB = STATUS_ORDER[b.status] ?? 99;
          cmp = orderA - orderB;
          if (cmp === 0) {
            cmp = a.fileName.localeCompare(b.fileName);
          }
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [items, sortField, sortDirection]);

  if (items.length === 0) {
    return (
      <div className="flex-1 min-h-[220px] flex items-center justify-center border border-[#e5e5e5] rounded-xl bg-white shadow-2xs text-[#737373] text-xs select-none">
        No downloads found in this view.
      </div>
    );
  }

  const selectionCount = selectedIds?.size ?? 0;
  const hasSelection = selectionCount > 0;
  const allVisibleSelected = sortedItems.every((item) => selectedIds?.has(item.id));
  const someVisibleSelected = sortedItems.some((item) => selectedIds?.has(item.id));

  const renderSortHeader = (
    field: SortField,
    label: string,
    extraColClass: string = 'px-3',
    align: 'left' | 'right' = 'left'
  ) => {
    const isActive = sortField === field;
    return (
      <th
        key={field}
        onClick={() => handleSort(field)}
        className={`${extraColClass} py-0 font-semibold ${
          align === 'right' ? 'text-right' : 'text-left'
        } whitespace-nowrap cursor-pointer group hover:bg-[#eaeaea]/80 transition-colors select-none ${
          isActive ? 'text-[#171717]' : 'text-[#737373]'
        }`}
        title={`Sort by ${label} (${
          isActive
            ? sortDirection === 'asc'
              ? 'Ascending (click to reverse)'
              : 'Descending (click to reset)'
            : 'click to sort'
        })`}
      >
        <div className={`flex items-center gap-1 min-w-0 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
          <span className="truncate">{label}</span>
          {isActive ? (
            sortDirection === 'asc' ? (
              <ArrowUp className="w-3 h-3 text-[#2563eb] stroke-[2.5] shrink-0" />
            ) : (
              <ArrowDown className="w-3 h-3 text-[#2563eb] stroke-[2.5] shrink-0" />
            )
          ) : (
            <ArrowUpDown className="w-2.5 h-2.5 text-[#a3a3a3] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
          )}
        </div>
      </th>
    );
  };

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-xl overflow-hidden shadow-[0_4px_7px_rgba(0,0,0,0.04)] select-none flex-1 min-h-[220px] flex flex-col">
      {/* Table Header: Fixed at top with clean rounded-t-xl corners */}
      <div className="w-full shrink-0 bg-[#f5f5f5] border-b border-[#e5e5e5]">
        <table className="w-full text-left border-collapse table-fixed">
          <colgroup>
            <col className="min-w-[180px]" />
            <col className="w-[96px]" />
            <col className="w-[146px]" />
            <col className="w-[88px]" />
            <col className="w-[80px]" />
            <col className="w-[106px]" />
            <col className="w-[134px]" />
          </colgroup>
          <thead>
            {hasSelection ? (
              /* Bulk action bar replaces the column labels while a selection exists,
                 so acting on many rows never shifts the table layout. */
              <tr className="h-9 bg-[#f5f5f5]">
                <th colSpan={7} className="px-4 py-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-[2px] rounded-full bg-[#171717] text-white text-[10px] font-semibold tabular-nums leading-none">
                        {selectionCount} selected
                      </span>
                      <span className="text-[11px] font-normal text-[#737373] truncate">
                        Apply an action to every selected download
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <BulkButton
                        icon={<Pause className="w-3 h-3 stroke-[2.2]" />}
                        label="Pause"
                        onClick={bulkActions?.pause}
                        disabled={!bulkActions?.canPause}
                      />
                      <BulkButton
                        icon={<Play className="w-3 h-3 stroke-[2.2] fill-current" />}
                        label="Resume"
                        onClick={bulkActions?.resume}
                        disabled={!bulkActions?.canResume}
                      />
                      <BulkButton
                        icon={<XCircle className="w-3 h-3 stroke-[2.2]" />}
                        label="Cancel"
                        onClick={bulkActions?.cancel}
                        disabled={!bulkActions?.canCancel}
                        tone="danger"
                      />
                      <button
                        type="button"
                        onClick={onClearSelection}
                        title="Clear selection"
                        aria-label="Clear selection"
                        className="ml-1 w-6 h-6 rounded-[6px] flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#e5e5e5] transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5 stroke-[2]" />
                      </button>
                    </div>
                  </div>
                </th>
              </tr>
            ) : (
              <tr className="h-9 bg-[#f5f5f5] text-[11px] font-semibold text-[#737373] tracking-[0.5px]">
                {/* Col 1: File Name & Origin */}
                <th
                  className={`pl-4 pr-3 py-0 font-semibold text-left select-none ${
                    sortField === 'name' ? 'text-[#171717]' : 'text-[#737373]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <SelectionCheckbox
                      checked={allVisibleSelected && sortedItems.length > 0}
                      indeterminate={!allVisibleSelected && someVisibleSelected}
                      onClick={() => onToggleSelectAll?.()}
                      label="Select all visible downloads"
                    />
                    <div
                      onClick={() => handleSort('name')}
                      className="flex items-center gap-1 min-w-0 cursor-pointer group hover:text-[#171717] transition-colors"
                      title={`Sort by File Name (${
                        sortField === 'name'
                          ? sortDirection === 'asc'
                            ? 'A-Z (click for Z-A)'
                            : 'Z-A (click to reset)'
                          : 'click to sort'
                      })`}
                    >
                      <span className="truncate">FILE NAME & ORIGIN</span>
                      {sortField === 'name' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#2563eb] stroke-[2.5] shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#2563eb] stroke-[2.5] shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-[#a3a3a3] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                      )}
                    </div>
                  </div>
                </th>

                {/* Col 2: Category */}
                {renderSortHeader('category', 'CATEGORY')}

                {/* Col 3: Size & Progress */}
                {renderSortHeader('size', 'SIZE & PROGRESS')}

                {/* Col 4: Speed */}
                {renderSortHeader('speed', 'SPEED')}

                {/* Col 5: Time Left */}
                {renderSortHeader('timeLeft', 'TIME LEFT')}

                {/* Col 6: Status */}
                {renderSortHeader('status', 'STATUS')}

                {/* Col 7: Actions */}
                <th className="pr-4 pl-2 py-0 font-semibold text-right whitespace-nowrap text-[#737373]">
                  ACTIONS
                </th>
              </tr>
            )}
          </thead>
        </table>
      </div>

      {/* Table Scrollable Body: Scrolling strictly below the header divider */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden rheow-scrollbar">
        <table className="w-full text-left border-collapse table-fixed">
          <colgroup>
            <col className="min-w-[180px]" />
            <col className="w-[96px]" />
            <col className="w-[146px]" />
            <col className="w-[88px]" />
            <col className="w-[80px]" />
            <col className="w-[106px]" />
            <col className="w-[134px]" />
          </colgroup>
          <tbody className="divide-y divide-[#e5e5e5] text-xs">
            {sortedItems.map((item) => {
              const isSelected = selectedId === item.id;
              const isChecked = selectedIds?.has(item.id) ?? false;
              const progress = Math.round(item.progressPercentage);

              return (
                <tr
                  key={item.id}
                  tabIndex={0}
                  onClick={() => onSelectItem(item)}
                  onDoubleClick={() => {
                    if (item.status === 'completed' && onOpenFile) {
                      onOpenFile(item.destinationPath);
                    } else {
                      onPauseToggle(item.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      item,
                      position: { x: e.clientX, y: e.clientY },
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({
                        item,
                        position: { x: rect.left + 80, y: Math.min(rect.bottom, window.innerHeight - 360) },
                      });
                    } else if (e.key === 'Enter') {
                      if (item.status === 'completed' && onOpenFile) {
                        onOpenFile(item.destinationPath);
                      } else {
                        onPauseToggle(item.id);
                      }
                    }
                  }}
                  className={`h-12 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[#2563eb] focus-visible:ring-inset ${
                    isSelected || isChecked ? 'bg-[#fafafa]' : 'bg-white hover:bg-[#fafafa]'
                  }`}
                >
                  {/* Col 1: File Col */}
                  <td className="pl-4 pr-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Selection checkbox — independent from the row that feeds the hero card */}
                      <SelectionCheckbox
                        checked={isChecked}
                        onClick={() => onToggleSelect?.(item.id)}
                        label={`Select ${item.fileName}`}
                      />

                      {/* File Icon Box */}
                      <div
                        className={`w-[26px] h-[26px] rounded-[6px] flex items-center justify-center shrink-0 transition-colors ${
                          isSelected || isChecked
                            ? 'bg-white border border-[#e5e5e5] shadow-2xs'
                            : 'bg-[#f5f5f5]'
                        }`}
                      >
                        {getCategoryIcon(item.category)}
                      </div>

                      {/* Name & Domain Group */}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
                        <span
                          className="text-[13px] font-semibold text-[#171717] truncate block"
                          title={item.fileName}
                        >
                          {truncateFileName(item.fileName, 34)}
                        </span>
                        <span
                          className="text-[11px] font-normal text-[#737373] truncate block"
                          title={item.domain}
                        >
                          {truncateUrl(item.domain, 26)}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Col 2: Category */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium inline-flex items-center ${getCategoryBadgeStyle(
                        item.category
                      )}`}
                    >
                      {item.category === 'Programs' ? 'Programs' : item.category}
                    </span>
                  </td>

                  {/* Col 3: Size & Progress */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="w-full max-w-[160px] flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="text-[#525252] truncate">
                          {formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}
                        </span>
                        <span
                          className={`font-medium shrink-0 ml-1.5 ${
                            progress === 100 ? 'text-[#16a34a]' : 'text-[#171717]'
                          }`}
                        >
                          {progress}%
                        </span>
                      </div>

                      <div className="w-full h-1 bg-[#e5e5e5] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            item.status === 'completed'
                              ? 'bg-[#16a34a]'
                              : item.status === 'error'
                              ? 'bg-[#dc2626]'
                              : item.status === 'paused'
                              ? 'bg-[#ea580c]'
                              : 'bg-[#2563eb]'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Col 4: Speed */}
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                    {item.status === 'downloading' ? (
                      <span className="text-[#2563eb]">
                        {formatBytes(item.speedBytesPerSecond)}/s
                      </span>
                    ) : item.status === 'completed' ? (
                      <span className="text-[#737373]">Avg 28.5 MB/s</span>
                    ) : item.status === 'queued' ? (
                      <span className="text-[#737373]">Queued</span>
                    ) : item.status === 'cancelled' ? (
                      <span className="text-[#dc2626]">Cancelled</span>
                    ) : item.status === 'error' ? (
                      <span className="text-[#dc2626]">—</span>
                    ) : (
                      <span className="text-[#737373]">0 KB/s</span>
                    )}
                  </td>

                  {/* Col 5: Time Left */}
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                    {item.status === 'downloading' ? (
                      <span className="text-[#171717]">{item.eta}</span>
                    ) : item.status === 'completed' ? (
                      <span className="text-[#737373]">Finished</span>
                    ) : item.status === 'queued' ? (
                      <span className="text-[#737373]">Queue #1</span>
                    ) : item.status === 'cancelled' ? (
                      <span className="text-[#737373]">Stopped</span>
                    ) : item.status === 'error' ? (
                      <span className="text-[#dc2626]">Failed</span>
                    ) : (
                      <span className="text-[#737373]">Paused</span>
                    )}
                  </td>

                  {/* Col 6: Status */}
                  <td
                    className="px-3 py-2 whitespace-nowrap"
                    onClick={(e) => {
                      if (onStatusClick) {
                        e.stopPropagation();
                        onStatusClick(item.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatusBadge status={item.status} />
                    </div>
                  </td>

                  {/* Col 7: Actions */}
                  <td
                    className="pr-4 pl-2 py-2 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Quick Action Button: FolderOpen or Play/Pause Toggle with Smooth Micro-Animation */}
                      {item.status === 'completed' ? (
                        <button
                          type="button"
                          onClick={() => onOpenFolder(item.destinationPath)}
                          title="Open Folder"
                          aria-label="Open containing folder"
                          className="group w-[30px] h-[30px] shrink-0 bg-white border border-[#e5e5e5] rounded-lg flex items-center justify-center text-[#171717] hover:text-[#2563eb] hover:border-blue-200 hover:bg-blue-50/60 active:scale-95 transition-all duration-200 shadow-2xs cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5 stroke-[2] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-110" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onPauseToggle(item.id)}
                          title={
                            item.status === 'downloading'
                              ? 'Pause download'
                              : item.status === 'error'
                              ? 'Retry download'
                              : 'Resume download'
                          }
                          aria-label={
                            item.status === 'downloading'
                              ? 'Pause download'
                              : item.status === 'error'
                              ? 'Retry download'
                              : 'Resume download'
                          }
                          className={`group relative w-[30px] h-[30px] shrink-0 bg-white border rounded-lg flex items-center justify-center transition-all duration-200 shadow-2xs cursor-pointer active:scale-95 overflow-hidden ${
                            item.status === 'downloading'
                              ? 'border-[#e5e5e5] text-[#171717] hover:text-[#ea580c] hover:border-orange-200 hover:bg-orange-50/60'
                              : 'border-[#e5e5e5] text-[#171717] hover:text-[#2563eb] hover:border-blue-200 hover:bg-blue-50/60'
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 flex items-center justify-center transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                              item.status === 'downloading' || item.status === 'error'
                                ? 'rotate-0'
                                : 'rotate-180'
                            }`}
                          >
                            {item.status === 'downloading' ? (
                              <Pause className="w-3.5 h-3.5 stroke-[2.2] transition-transform duration-200 group-hover:scale-110" />
                            ) : item.status === 'error' ? (
                              <RotateCcw className="w-3.5 h-3.5 stroke-[2.2] transition-transform duration-300 group-hover:-rotate-90" />
                            ) : (
                              <Play className="w-3.5 h-3.5 stroke-[2] fill-current -rotate-180 transition-transform duration-200 group-hover:scale-110 group-hover:translate-x-0.5" />
                            )}
                          </div>
                        </button>
                      )}

                      {/* Refresh Link button on failed download */}
                      {item.status === 'error' && onRefreshLink && (
                        <button
                          type="button"
                          onClick={() => onRefreshLink(item)}
                          title="Refresh Download Address"
                          aria-label="Refresh Download Address"
                          className="group w-[30px] h-[30px] shrink-0 bg-white border border-[#e5e5e5] rounded-lg flex items-center justify-center text-[#2563eb] hover:border-blue-200 hover:bg-blue-50/60 active:scale-95 transition-all duration-200 shadow-2xs cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5 stroke-[2] transition-transform duration-300 group-hover:rotate-180" />
                        </button>
                      )}

                      {/* Cancel Button (only meaningful while a download can still be stopped) */}
                      {(item.status === 'downloading' ||
                        item.status === 'queued' ||
                        item.status === 'paused') &&
                        onCancel && (
                        <button
                          type="button"
                          onClick={() => onCancel(item.id)}
                          title="Cancel Download"
                          aria-label="Cancel Download"
                          className="group w-[30px] h-[30px] shrink-0 bg-white border border-[#e5e5e5] rounded-lg flex items-center justify-center text-[#737373] hover:text-red-500 hover:border-red-200 hover:bg-red-50/60 active:scale-95 transition-all duration-200 shadow-2xs cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5 stroke-[2] transition-transform duration-200 ease-out group-hover:scale-110" />
                        </button>
                      )}

                      {/* Delete Button with Playful Wiggle Micro-Interaction */}
                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        title="Delete download"
                        aria-label="Delete download"
                        className="group w-[30px] h-[30px] shrink-0 bg-white border border-[#e5e5e5] rounded-lg flex items-center justify-center text-[#737373] hover:text-red-600 hover:border-red-200 hover:bg-red-50/60 active:scale-95 active:rotate-12 transition-all duration-200 shadow-2xs cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 stroke-[2] transition-transform duration-200 ease-out group-hover:scale-110 group-hover:rotate-[-10deg]" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <DownloadContextMenu
          item={contextMenu.item}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onOpenFile={(path) => onOpenFile?.(path)}
          onOpenFolder={onOpenFolder}
          onCopyUrl={(url) => onCopyUrl?.(url)}
          onPauseToggle={onPauseToggle}
          onRedownload={(id) => onRedownload?.(id)}
          onCancel={(id) => onCancel?.(id)}
          onDelete={(id, deleteFile) => onDelete(id, deleteFile)}
          onViewDetails={onViewDetails}
          onRefreshLink={onRefreshLink}
          onLimitSpeed={onLimitSpeed}
        />
      )}
    </div>
  );
};

const SelectionCheckbox: React.FC<{
  checked: boolean;
  indeterminate?: boolean;
  onClick?: () => void;
  label: string;
}> = ({ checked, indeterminate = false, onClick, label }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={indeterminate ? 'mixed' : checked}
    aria-label={label}
    onClick={(e) => {
      e.stopPropagation();
      onClick?.();
    }}
    className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/30 ${
      checked || indeterminate
        ? 'bg-[#171717] border-[#171717] text-white'
        : 'bg-white border-[#d4d4d4] hover:border-[#a3a3a3]'
    }`}
  >
    {indeterminate ? (
      <Minus className="w-2.5 h-2.5 stroke-[3]" />
    ) : checked ? (
      <Check className="w-2.5 h-2.5 stroke-[2.5]" />
    ) : null}
  </button>
);

const BulkButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}> = ({ icon, label, onClick, disabled, tone = 'default' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    className={`h-6 px-2 rounded-[6px] border border-[#e5e5e5] bg-white text-[11px] font-medium flex items-center gap-1 shadow-2xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white disabled:hover:border-[#e5e5e5] ${
      tone === 'danger'
        ? 'text-[#525252] hover:text-red-600 hover:border-red-200 hover:bg-red-50/60'
        : 'text-[#171717] hover:bg-[#f5f5f5]'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

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

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const [animating, setAnimating] = React.useState(false);
  const prevStatusRef = React.useRef(status);

  React.useEffect(() => {
    if (prevStatusRef.current !== status) {
      prevStatusRef.current = status;
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 900);
      return () => clearTimeout(timer);
    }
  }, [status]);

  switch (status) {
    case 'downloading':
      return (
        <span
          className={`bg-[#dbeaff] border border-[#bfdbfe]/60 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#2563eb] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop' : ''
          }`}
        >
          <ArrowDown className="w-2.5 h-2.5 text-[#2563eb] stroke-[2.5] animate-arrow-glide" />
          <span>Downloading</span>
        </span>
      );
    case 'completed':
      return (
        <span
          className={`bg-[#dcfce7] border border-[#bbf7d0]/60 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#16a34a] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop animate-completed-glow' : ''
          }`}
        >
          <Check
            className={`w-2.5 h-2.5 text-[#16a34a] stroke-[2.5] ${
              animating ? 'animate-check-spring' : ''
            }`}
          />
          <span>Completed</span>
        </span>
      );
    case 'paused':
      return (
        <span
          className={`bg-[#ffedd5] border border-[#fed7aa]/60 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#ea580c] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop' : ''
          }`}
        >
          <Pause
            className={`w-2.5 h-2.5 text-[#ea580c] stroke-[2.5] ${
              animating ? 'animate-pause-pop' : ''
            }`}
          />
          <span>Paused</span>
        </span>
      );
    case 'queued':
      return (
        <span
          className={`bg-[#f3e8ff] border border-[#e9d5ff]/60 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#7c3aed] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop' : ''
          }`}
        >
          <Timer className="w-2.5 h-2.5 text-[#7c3aed] stroke-[2.5] animate-spin-slow" />
          <span>Queued</span>
        </span>
      );
    case 'cancelled':
      return (
        <span
          className={`bg-[#fef2f2] border border-[#fecaca]/80 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#dc2626] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop' : ''
          }`}
        >
          <XCircle className="w-2.5 h-2.5 text-[#dc2626] stroke-[2.5]" />
          <span>Cancelled</span>
        </span>
      );
    case 'error':
      return (
        <span
          className={`bg-[#fee2e2] border border-[#fecaca]/70 rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#dc2626] transition-all duration-300 select-none ${
            animating ? 'animate-status-pop' : ''
          }`}
        >
          <AlertCircle className="w-2.5 h-2.5 text-[#dc2626] stroke-[2.5]" />
          <span>Failed</span>
        </span>
      );
    default:
      return (
        <span className="bg-[#f5f5f5] border border-[#e5e5e5] rounded-full px-[7px] py-[2px] inline-flex items-center gap-1 text-[10px] font-medium text-[#737373]">
          {status}
        </span>
      );
  }
};
