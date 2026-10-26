import React, { useState, useEffect, useRef } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Radio,
  ClipboardPaste,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Play,
  RotateCw,
  Copy,
  Check,
  Layers,
  FileText,
  Archive,
  Terminal,
  Film,
  Music,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadItem, DownloadCategory } from '../types/download';
import { formatBytes, truncateFileName, truncateUrl } from '../utils/format';

export interface RefreshLinkModalProps {
  isOpen: boolean;
  item: DownloadItem | null;
  onClose: () => void;
  onSuccess: (updatedItem: DownloadItem) => void;
  /** Captured payload forwarded from browser extension */
  incomingBrowserAdd?: {
    url: string;
    filename?: string;
    cookie?: string;
    referer?: string;
  } | null;
  onClearIncomingBrowserAdd?: () => void;
}

interface ProbeResult {
  url: string;
  filename: string;
  category: string;
  total_size: number;
  supports_range: boolean;
  etag?: string | null;
  last_modified?: string | null;
}

function getCategoryIcon(cat: DownloadCategory) {
  switch (cat) {
    case 'Compressed':
      return <Archive className="w-4 h-4 text-[#7c3aed] stroke-[2]" />;
    case 'Programs':
      return <Terminal className="w-4 h-4 text-[#2563eb] stroke-[2]" />;
    case 'Video':
      return <Film className="w-4 h-4 text-[#ea580c] stroke-[2]" />;
    case 'Documents':
      return <FileText className="w-4 h-4 text-[#16a34a] stroke-[2]" />;
    case 'Music':
      return <Music className="w-4 h-4 text-[#ec4899] stroke-[2]" />;
    default:
      return <FileText className="w-4 h-4 text-[#737373] stroke-[2]" />;
  }
}

export const RefreshLinkModal: React.FC<RefreshLinkModalProps> = ({
  isOpen,
  item,
  onClose,
  onSuccess,
  incomingBrowserAdd,
  onClearIncomingBrowserAdd,
}) => {
  const [newUrl, setNewUrl] = useState('');
  const [newCookie, setNewCookie] = useState('');
  const [newReferer, setNewReferer] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [hasOpenedBrowser, setHasOpenedBrowser] = useState(false);
  const [copiedOriginal, setCopiedOriginal] = useState(false);

  const initialUrlRef = useRef<string>('');

  // Reset or initialize state when modal opens or item changes
  useEffect(() => {
    if (isOpen && item) {
      initialUrlRef.current = item.url;
      setNewUrl('');
      setNewCookie(item.cookie || '');
      setNewReferer(item.referer || '');
      setProbeResult(null);
      setProbeError(null);
      setIsProbing(false);
      setIsApplying(false);
      setHasOpenedBrowser(false);
      setCopiedOriginal(false);
    }
  }, [isOpen, item]);

  // Handle incoming browser capture
  useEffect(() => {
    if (isOpen && incomingBrowserAdd && incomingBrowserAdd.url) {
      const capturedUrl = incomingBrowserAdd.url.trim();
      setNewUrl(capturedUrl);
      if (incomingBrowserAdd.cookie) {
        setNewCookie(incomingBrowserAdd.cookie);
      }
      if (incomingBrowserAdd.referer) {
        setNewReferer(incomingBrowserAdd.referer);
      }
      // Automatically probe the captured link
      runProbe(capturedUrl, incomingBrowserAdd.cookie, incomingBrowserAdd.referer);
      onClearIncomingBrowserAdd?.();
    }
  }, [isOpen, incomingBrowserAdd]);

  if (!isOpen || !item) return null;

  const progressPercent = Math.round(item.progressPercentage || 0);
  const sourceWebpage = item.referer || item.url;

  const handleOpenBrowser = async () => {
    try {
      setHasOpenedBrowser(true);
      await invoke('open_browser_url', { url: sourceWebpage });
    } catch (err: any) {
      console.error('Failed to open browser URL:', err);
      // Fallback: try window.open
      window.open(sourceWebpage, '_blank');
    }
  };

  const runProbe = async (urlToProbe: string, cookieToUse?: string, refererToUse?: string) => {
    if (!urlToProbe.trim()) return;
    setIsProbing(true);
    setProbeError(null);
    setProbeResult(null);

    try {
      const res = await invoke<ProbeResult>('probe_download', {
        url: urlToProbe.trim(),
        cookie: cookieToUse || newCookie.trim() || null,
        referer: refererToUse || newReferer.trim() || null,
        timeout: 15,
      });
      setProbeResult(res);
    } catch (err: any) {
      console.warn('Probe error on refreshed link:', err);
      setProbeError(typeof err === 'string' ? err : err?.message || 'Failed to contact server');
    } finally {
      setIsProbing(false);
    }
  };

  const handleManualProbeClick = () => {
    if (newUrl.trim()) {
      runProbe(newUrl.trim());
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      let text = '';
      try {
        text = await invoke<string>('read_clipboard_text');
      } catch {
        text = await navigator.clipboard.readText();
      }

      if (text && text.trim().startsWith('http')) {
        const clean = text.trim();
        setNewUrl(clean);
        runProbe(clean);
      }
    } catch (e) {
      console.error('Failed to read clipboard:', e);
    }
  };

  const handleCopyOriginalUrl = () => {
    navigator.clipboard.writeText(sourceWebpage);
    setCopiedOriginal(true);
    setTimeout(() => setCopiedOriginal(false), 1500);
  };

  const handleApplyAndUpdate = async (restartFromZero = false) => {
    if (!newUrl.trim() || isApplying) return;

    setIsApplying(true);
    try {
      if (restartFromZero) {
        // Update URL first, then redownload
        await invoke('update_download_url', {
          id: item.id,
          url: newUrl.trim(),
          cookie: newCookie.trim() || null,
          referer: newReferer.trim() || null,
          etag: probeResult?.etag || null,
          lastModified: probeResult?.last_modified || null,
          autoResume: false,
        });
        await invoke('redownload', { id: item.id });
      } else {
        // Standard resume: preserve segments and downloaded bytes
        await invoke('update_download_url', {
          id: item.id,
          url: newUrl.trim(),
          cookie: newCookie.trim() || null,
          referer: newReferer.trim() || null,
          etag: probeResult?.etag || null,
          lastModified: probeResult?.last_modified || null,
          autoResume: true,
        });
      }

      onSuccess({
        ...item,
        url: newUrl.trim(),
        cookie: newCookie.trim() || item.cookie,
        referer: newReferer.trim() || item.referer,
        status: 'downloading',
      });
      onClose();
    } catch (err: any) {
      console.error('Failed to update download URL:', err);
      setProbeError(typeof err === 'string' ? err : 'Failed to refresh download link');
      setIsApplying(false);
    }
  };

  const isSizeMatch =
    probeResult &&
    item.totalSize > 0 &&
    probeResult.total_size > 0 &&
    item.totalSize === probeResult.total_size;

  const isSizeMismatch =
    probeResult &&
    item.totalSize > 0 &&
    probeResult.total_size > 0 &&
    item.totalSize !== probeResult.total_size;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApplying) onClose();
      }}
    >
      <div
        className="bg-white border border-[#e5e5e5] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex flex-col w-full max-w-[560px] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e5] bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#2563eb] shadow-2xs">
              <RefreshCw className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#171717] tracking-tight">
                Refresh Download Address
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#eaeaea] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* File Overview Card */}
          <div className="bg-[#fcfcfc] border border-[#e5e5e5] rounded-xl p-3.5 space-y-2.5 shadow-2xs">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white border border-[#e5e5e5] flex items-center justify-center shrink-0 shadow-2xs">
                {getCategoryIcon(item.category)}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-semibold text-[#171717] truncate leading-tight"
                  title={item.fileName}
                >
                  {truncateFileName(item.fileName, 44)}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-[#525252]">
                  <span>
                    {formatBytes(item.downloadedSize)} / {formatBytes(item.totalSize)}
                  </span>
                  <span className="text-[#d4d4d4]">•</span>
                  <span className="font-semibold text-[#2563eb]">{progressPercent}% saved</span>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2563eb] rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Source Page & Browser Capture */}
          <div className="border border-[#e5e5e5] rounded-xl p-4 space-y-3 bg-white">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-medium text-[#171717] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#2563eb]" />
                <span>Automatic Capture from Browser</span>
              </div>
              <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Automatic
              </span>
            </div>

            {/* Original Webpage info */}
            <div className="bg-[#f5f5f5] rounded-lg p-2.5 flex items-center justify-between gap-2 border border-[#e5e5e5]">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-[#737373]">
                  Source Page / Referer:
                </div>
                <div
                  className="text-[11px] font-mono text-[#171717] truncate"
                  title={sourceWebpage}
                >
                  {truncateUrl(sourceWebpage, 48)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyOriginalUrl}
                  title="Copy Page URL"
                  className="px-2 py-1 rounded bg-white border border-[#e5e5e5] hover:bg-[#eaeaea] text-[#525252] text-[10px] flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                >
                  {copiedOriginal ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedOriginal ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenBrowser}
                  className="px-2.5 py-1 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-[11px] font-medium flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open in Browser</span>
                </button>
              </div>
            </div>

            {/* Radar / Listening Animation Card */}
            <div
              className={`rounded-xl border p-3 flex items-center gap-3 transition-colors ${
                newUrl
                  ? 'bg-blue-50/50 border-blue-200'
                  : 'bg-gradient-to-r from-blue-50/30 to-purple-50/30 border-blue-100'
              }`}
            >
              <div className="relative w-8 h-8 rounded-full bg-blue-100/80 flex items-center justify-center shrink-0">
                {isProbing ? (
                  <Loader2 className="w-4 h-4 text-[#2563eb] animate-spin" />
                ) : newUrl ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <>
                    <span className="absolute inset-0 rounded-full bg-blue-400 opacity-40 animate-ping" />
                    <Radio className="w-4 h-4 text-[#2563eb] relative z-10" />
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {isProbing ? (
                  <div className="text-[12px] font-medium text-[#2563eb]">
                    Verifying new link with server...
                  </div>
                ) : newUrl ? (
                  <div>
                    <div className="text-[12px] font-semibold text-[#171717] flex items-center gap-1.5">
                      <span>New Link Successfully Captured!</span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-normal">
                        Ready
                      </span>
                    </div>
                    <div className="text-[11px] text-[#737373] font-mono truncate mt-0.5">
                      {truncateUrl(newUrl, 46)}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-[12px] font-medium text-[#171717]">
                      {hasOpenedBrowser
                        ? 'Waiting for download click in your browser...'
                        : 'Waiting for new download link from browser...'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Manual Input Toggle / Section */}
          <div className="border border-[#e5e5e5] rounded-xl p-3.5 bg-white space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[#171717]">
                Or Paste Link Manually
              </span>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="text-[11px] text-[#2563eb] hover:underline flex items-center gap-1 cursor-pointer font-medium"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>Paste from Clipboard</span>
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#fafafa] border border-[#e5e5e5] rounded-lg px-3 py-1.5 text-xs font-mono text-[#171717] placeholder:text-[#a3a3a3] focus:outline-none focus:border-[#2563eb] focus:bg-white transition-all shadow-2xs"
                />
              </div>
              <button
                type="button"
                onClick={handleManualProbeClick}
                disabled={!newUrl.trim() || isProbing}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#e5e5e5] hover:bg-[#f5f5f5] text-[#171717] text-xs font-medium flex items-center gap-1.5 shadow-2xs transition-all disabled:opacity-50 cursor-pointer"
              >
                {isProbing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Check</span>
              </button>
            </div>
          </div>

          {/* Validation & Comparison Result Card */}
          {probeResult && (
            <div className="border border-[#e5e5e5] rounded-xl p-3 bg-[#fafafa] space-y-2 animate-in fade-in duration-150">
              {/* Size Match Verification */}
              {isSizeMatch && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    <strong>File size matches:</strong> {formatBytes(probeResult.total_size)}
                  </span>
                </div>
              )}

              {/* Size Mismatch Warning */}
              {isSizeMismatch && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Attention: File Size Differs</span>
                  </div>
                  <div className="text-[#78350f]">
                    Old size: <strong>{formatBytes(item.totalSize)}</strong> vs New size:{' '}
                    <strong>{formatBytes(probeResult.total_size)}</strong>.
                    If this file is a different version, resuming may result in corrupted data.
                  </div>
                </div>
              )}

              {/* Range Support */}
              <div className="flex items-center justify-between text-[11px] text-[#525252] px-1">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#2563eb]" />
                  <span>Multi-Segment Resume Support:</span>
                </span>
                <span className="font-semibold">
                  {probeResult.supports_range ? (
                    <span className="text-emerald-700">Yes (Supported)</span>
                  ) : (
                    <span className="text-amber-700">No (Single Stream)</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Probe Error Alert */}
          {probeError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-[11px]">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Warning while checking link:</div>
                <div className="text-red-700 mt-0.5">{probeError}</div>
                <div className="text-[10px] text-red-600 mt-1">
                  You can still attempt to apply this link if you are certain the URL is valid.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#e5e5e5] bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="px-3.5 py-1.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#525252] text-xs font-medium cursor-pointer shadow-2xs transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {isSizeMismatch && (
              <button
                type="button"
                onClick={() => handleApplyAndUpdate(true)}
                disabled={isApplying}
                className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Download from Beginning</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleApplyAndUpdate(false)}
              disabled={!newUrl.trim() || isProbing || isApplying}
              className="px-4 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium flex items-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isApplying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Apply & Resume Download</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
