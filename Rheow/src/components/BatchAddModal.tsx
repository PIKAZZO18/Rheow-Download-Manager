import React, { useState, useEffect, useRef } from 'react';
import {
  ListPlus,
  ClipboardPaste,
  Upload,
  Trash2,
  X,
  Check,
  AlertCircle,
  Loader2,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  Archive,
  Terminal,
  Film,
  FileText,
  Music,
  FolderArchive,
  Play,
  Clock,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadCategory } from '../types/download';
import { formatBytes, truncateFileName } from '../utils/format';

export interface BatchItem {
  id: string;
  url: string;
  filename: string;
  category: DownloadCategory;
  totalSize: number;
  supportsRange: boolean;
  destinationPath: string;
  status: 'idle' | 'probing' | 'ready' | 'error';
  errorMessage?: string;
  selected: boolean;
  etag?: string;
  lastModified?: string;
}

interface BatchAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDownloadPath?: string;
  categorySubfolders?: Record<string, string>;
  defaultSegmentCount?: number;
  connectionTimeoutSeconds?: number;
  initialUrls?: string[];
  onConfirmBatch: (items: BatchItem[], startImmediately: boolean) => Promise<void>;
}

function parseUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  const matches = text.match(urlRegex) || [];
  // Deduplicate and trim trailing punctuation
  const cleaned = matches.map((u) => u.replace(/[.,;:)\]]+$/, ''));
  return Array.from(new Set(cleaned));
}

function guessCategory(filename: string): DownloadCategory {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'tgz'].includes(ext)) return 'Compressed';
  if (['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk'].includes(ext)) return 'Programs';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'].includes(ext)) return 'Video';
  if (['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'txt', 'epub'].includes(ext)) return 'Documents';
  if (['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a'].includes(ext)) return 'Music';
  return 'Other';
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
    default:
      return <FolderArchive className="w-3.5 h-3.5 text-[#525252] stroke-[2]" />;
  }
}

export const BatchAddModal: React.FC<BatchAddModalProps> = ({
  isOpen,
  onClose,
  defaultDownloadPath,
  categorySubfolders = {},
  connectionTimeoutSeconds = 30,
  initialUrls,
  onConfirmBatch,
}) => {
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [rawText, setRawText] = useState('');
  const [items, setItems] = useState<BatchItem[]>([]);
  const [startImmediately, setStartImmediately] = useState(true);
  const [customBasePath, setCustomBasePath] = useState<string | undefined>(defaultDownloadPath);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync default path when opened
  useEffect(() => {
    if (isOpen) {
      setCustomBasePath(defaultDownloadPath);
      setStep('input');
      setRawText(initialUrls && initialUrls.length > 0 ? initialUrls.join('\n') : '');
      setItems([]);
      setIsSubmitting(false);
    }
  }, [isOpen, defaultDownloadPath, initialUrls]);

  // Escape key listener to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const detectedUrls = parseUrls(rawText);

  const handlePasteClipboard = async () => {
    try {
      const nativeText = await invoke<string>('read_clipboard_text');
      if (nativeText) {
        setRawText((prev) => (prev ? `${prev}\n${nativeText}` : nativeText));
        return;
      }
    } catch {}

    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setRawText((prev) => (prev ? `${prev}\n${text}` : text));
        }
      }
    } catch {}
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawText((prev) => (prev ? `${prev}\n${content}` : content));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleProbeAndReview = async () => {
    if (detectedUrls.length === 0) return;

    // Create initial items
    const initialItems: BatchItem[] = detectedUrls.map((url, index) => {
      let initialName = `download_${index + 1}`;
      try {
        const parsed = new URL(url);
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length > 0) {
          initialName = decodeURIComponent(segments[segments.length - 1]);
        }
      } catch {}

      const cat = guessCategory(initialName);
      return {
        id: `batch-${Date.now()}-${index}`,
        url,
        filename: initialName,
        category: cat,
        totalSize: 0,
        supportsRange: true,
        destinationPath: '',
        status: 'probing',
        selected: true,
      };
    });

    setItems(initialItems);
    setStep('review');

    // Probe URLs in parallel (concurrency 4 to balance speed and network sockets)
    const probeItem = async (item: BatchItem) => {
      try {
        const probeRes = await invoke<{
          filename: string;
          total_size: number;
          supports_range: boolean;
          etag?: string;
          last_modified?: string;
        }>('probe_download', {
          url: item.url,
          timeoutSeconds: connectionTimeoutSeconds,
        });

        const cat = guessCategory(probeRes.filename || item.filename);

        // Resolve destination path
        let dest = '';
        try {
          dest = await invoke<string>('get_default_destination', {
            category: cat,
            filename: probeRes.filename || item.filename,
            basePath: customBasePath,
            categorySubfolders,
          });
        } catch {}

        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  filename: probeRes.filename || item.filename,
                  totalSize: probeRes.total_size || 0,
                  supportsRange: probeRes.supports_range,
                  category: cat,
                  destinationPath: dest,
                  status: 'ready',
                  etag: probeRes.etag,
                  lastModified: probeRes.last_modified,
                }
              : i
          )
        );
      } catch (err: any) {
        // Even if probe fails, fallback to URL filename so user can still download
        const cat = item.category;
        let dest = '';
        try {
          dest = await invoke<string>('get_default_destination', {
            category: cat,
            filename: item.filename,
            basePath: customBasePath,
            categorySubfolders,
          });
        } catch {}

        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  destinationPath: dest,
                  status: 'ready', // allow download attempt
                  errorMessage: typeof err === 'string' ? err : 'Server didn\'t return size',
                }
              : i
          )
        );
      }
    };

    // Execute with pool limit
    const poolLimit = 4;
    const queue = [...initialItems];
    const workers = Array.from({ length: poolLimit }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await probeItem(next);
      }
    });
    await Promise.allSettled(workers);
  };

  const handleSelectAllToggle = () => {
    const allSelected = items.every((i) => i.selected);
    setItems((prev) => prev.map((i) => ({ ...i, selected: !allSelected })));
  };

  const handleItemToggle = (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  };

  const handleChangeFolder = async () => {
    try {
      const selected = await invoke<string | null>('pick_destination_folder', {
        defaultPath: customBasePath,
      });
      if (selected) {
        setCustomBasePath(selected);
        // Refresh paths for all items
        setItems((prev) =>
          prev.map((item) => ({
            ...item,
            destinationPath: `${selected}\\${item.filename}`,
          }))
        );
      }
    } catch (e) {
      console.error('Failed to pick folder:', e);
    }
  };

  const handleSubmit = async () => {
    const selectedItems = items.filter((i) => i.selected);
    if (selectedItems.length === 0) return;

    setIsSubmitting(true);
    try {
      await onConfirmBatch(selectedItems, startImmediately);
      onClose();
    } catch (err) {
      console.error('Batch import failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCount = items.filter((i) => i.selected).length;
  const totalBytesSelected = items
    .filter((i) => i.selected)
    .reduce((sum, i) => sum + Math.max(0, i.totalSize), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[740px] max-h-[90vh] bg-white border border-[#e5e5e5] rounded-[16px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden text-[#171717]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e5e5e5] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#2563eb]">
              <ListPlus className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#171717] tracking-tight">
                {step === 'input' ? 'Add Batch Downloads' : 'Review Batch Downloads'}
              </h2>
              {step !== 'input' && (
                <p className="text-[11px] text-[#737373] mt-0.5">
                  {`${selectedCount} of ${items.length} files selected for download.`}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* Modal Body */}
        {step === 'input' ? (
          <div className="p-5 flex flex-col gap-3.5 overflow-y-auto">
            {/* Toolbar Buttons */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] hover:bg-[#f5f5f5] text-xs font-medium text-[#171717] transition-colors cursor-pointer shadow-2xs"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />
                  <span>Paste from Clipboard</span>
                </button>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".txt,.m3u,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] hover:bg-[#f5f5f5] text-xs font-medium text-[#171717] transition-colors cursor-pointer shadow-2xs"
                >
                  <Upload className="w-3.5 h-3.5 stroke-[2] text-[#525252]" />
                  <span>Import .txt File</span>
                </button>
              </div>

              {rawText && (
                <button
                  type="button"
                  onClick={() => setRawText('')}
                  className="flex items-center gap-1 text-xs text-[#737373] hover:text-red-600 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Clear All</span>
                </button>
              )}
            </div>

            {/* Textarea */}
            <div className="relative">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso&#10;https://proof.ovh.net/files/100Mb.dat&#10;https://cdn.example.com/videos/archive.mp4"
                rows={10}
                className="w-full font-mono text-xs p-3.5 bg-white border border-[#e5e5e5] rounded-xl focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 outline-none transition-all placeholder:text-[#a3a3a3] resize-none leading-relaxed"
                autoFocus
              />

              <div className="absolute right-3 bottom-3 text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#f5f5f5] text-[#737373] border border-[#e5e5e5]/80 pointer-events-none">
                {detectedUrls.length} {detectedUrls.length === 1 ? 'URL' : 'URLs'} found
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col p-5 gap-3.5 overflow-hidden">
            {/* Folder Destination Bar */}
            <div className="flex items-center justify-between gap-3 p-3 bg-[#fafafa] border border-[#e5e5e5] rounded-xl text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <FolderOpen className="w-4 h-4 text-[#737373] shrink-0" />
                <span className="text-[#737373] shrink-0">Save destination:</span>
                <span className="font-mono text-[#171717] truncate font-medium" title={customBasePath}>
                  {customBasePath || 'Default Downloads folder'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleChangeFolder}
                className="px-2.5 py-1 rounded-md bg-white border border-[#e5e5e5] hover:bg-[#f5f5f5] text-[11px] font-medium text-[#171717] transition-colors cursor-pointer shrink-0"
              >
                Change Folder
              </button>
            </div>

            {/* Items Table Card */}
            <div className="flex-1 min-h-[220px] max-h-[360px] border border-[#e5e5e5] rounded-xl overflow-hidden flex flex-col bg-white shadow-2xs">
              {/* Header */}
              <div className="bg-[#f5f5f5] border-b border-[#e5e5e5] px-3.5 py-2 flex items-center justify-between text-[11px] font-semibold text-[#737373] tracking-wide">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((i) => i.selected)}
                    onChange={handleSelectAllToggle}
                    className="w-3.5 h-3.5 rounded border-[#d4d4d4] text-black focus:ring-0 cursor-pointer"
                  />
                  <span>FILE & URL ({items.length})</span>
                </div>
                <div className="flex items-center gap-6">
                  <span>CATEGORY</span>
                  <span className="w-16 text-right">SIZE</span>
                  <span className="w-16 text-right">STATUS</span>
                </div>
              </div>

              {/* Rows */}
              <div className="flex-1 overflow-y-auto divide-y divide-[#e5e5e5] text-xs">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleItemToggle(item.id)}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#fafafa] transition-colors cursor-pointer ${
                      item.selected ? 'bg-white' : 'opacity-60 bg-[#fafafa]/50'
                    }`}
                  >
                    {/* File name & URL */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleItemToggle(item.id);
                        }}
                        className="w-3.5 h-3.5 rounded border-[#d4d4d4] text-black focus:ring-0 cursor-pointer"
                      />
                      <div className="w-6 h-6 rounded bg-[#f5f5f5] flex items-center justify-center shrink-0">
                        {getCategoryIcon(item.category)}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium text-[#171717] truncate text-[12px]" title={item.filename}>
                          {truncateFileName(item.filename, 40)}
                        </span>
                        <span className="text-[10px] text-[#737373] font-mono truncate" title={item.url}>
                          {item.url}
                        </span>
                      </div>
                    </div>

                    {/* Metadata columns */}
                    <div className="flex items-center gap-6 shrink-0 text-xs">
                      <span className="text-[11px] font-medium text-[#525252] bg-[#f5f5f5] px-2 py-0.5 rounded-full">
                        {item.category}
                      </span>
                      <span className="w-16 text-right font-mono text-[11px] text-[#171717]">
                        {item.totalSize > 0 ? formatBytes(item.totalSize) : '—'}
                      </span>
                      <div className="w-16 flex items-center justify-end">
                        {item.status === 'probing' ? (
                          <span className="flex items-center gap-1 text-[11px] text-[#2563eb]">
                            <Loader2 className="w-3 h-3 animate-spin stroke-[2.5]" />
                          </span>
                        ) : item.errorMessage ? (
                          <span className="flex items-center gap-1 text-[11px] text-[#ea580c]" title={item.errorMessage}>
                            <AlertCircle className="w-3.5 h-3.5 stroke-[2]" />
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-[#16a34a]">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mode selection toggle */}
            <div className="flex items-center justify-between text-xs pt-1 px-1">
              <label className="flex items-center gap-2 text-[#171717] font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={startImmediately}
                  onChange={(e) => setStartImmediately(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[#d4d4d4] text-black focus:ring-0 cursor-pointer"
                />
                <span className="flex items-center gap-1.5">
                  {startImmediately ? (
                    <>
                      <Play className="w-3.5 h-3.5 text-[#2563eb] fill-current" />
                      <span>Start downloading immediately (FIFO queue)</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-3.5 h-3.5 text-[#737373]" />
                      <span>Add as Queued only (start manually later)</span>
                    </>
                  )}
                </span>
              </label>

              <span className="text-[11px] text-[#737373] font-mono">
                Total size: <strong>{formatBytes(totalBytesSelected)}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#f5f5f5] border-t border-[#e5e5e5] flex items-center justify-between shrink-0">
          {step === 'review' ? (
            <button
              type="button"
              onClick={() => setStep('input')}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] hover:bg-white text-xs font-medium text-[#171717] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 stroke-[2]" />
              <span>Back to Edit</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-[#e5e5e5] hover:bg-white text-xs font-medium text-[#171717] transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {step === 'input' ? (
              <button
                type="button"
                onClick={handleProbeAndReview}
                disabled={detectedUrls.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-black hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white transition-all shadow-xs cursor-pointer"
              >
                <span>Review & Probe ({detectedUrls.length})</span>
                <ArrowRight className="w-3.5 h-3.5 stroke-[2]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={selectedCount === 0 || isSubmitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white transition-all shadow-xs cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Adding downloads...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>
                      {startImmediately
                        ? `Start Download (${selectedCount})`
                        : `Add to Queue (${selectedCount})`}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
