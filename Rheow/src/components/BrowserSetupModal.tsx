import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RheowLogo } from './brand/RheowLogo';
import {
  X,
  FolderOpen,
  Copy,
  Check,
  Globe,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface BrowserSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BridgeStatus {
  running: boolean;
  extension_connected: boolean;
}

interface BrowserIntegrationStatus {
  bridge: BridgeStatus;
  extension_path: string | null;
  extension_setup_path: string | null;
  extension_version: string | null;
}

interface ExtensionSetupInfo {
  path: string;
  version: string | null;
  copied: boolean;
}

interface BrowserLaunchInfo {
  browser: string;
  extensions_url: string;
}

type Step = 1 | 2;
type BusyAction = 'browser' | 'folder' | 'copy' | 'check' | null;
type CopiedField = 'path' | null;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Install in browser' },
  { id: 2, label: 'Done' },
];

const primaryButton =
  'h-8 px-3 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-medium flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

const secondaryButton =
  'h-8 px-3 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] text-[#171717] text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

const iconTile =
  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border';

export const BrowserSetupModal: React.FC<BrowserSetupModalProps> = ({ isOpen, onClose }) => {
  const [step, setStep] = useState<Step>(1);
  const [info, setInfo] = useState<ExtensionSetupInfo | null>(null);
  const [launch, setLaunch] = useState<BrowserLaunchInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [copiedField, setCopiedField] = useState<CopiedField>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const copiedTimer = useRef<number | null>(null);

  const flashCopied = (field: CopiedField) => {
    setCopiedField(field);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedField(null), 2200);
  };

  // Reset the wizard every time it opens, then make sure the bundled extension
  // has been copied to the user-writable folder before showing the path.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setStep(1);
    setInfo(null);
    setLaunch(null);
    setConnected(false);
    setBusy(null);
    setError(null);
    setCheckMessage(null);
    setCopiedField(null);

    invoke<ExtensionSetupInfo>('prepare_browser_extension')
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    // Detect the default browser up front so the address and button already
    // point at the right extensions page before the user clicks.
    invoke<BrowserLaunchInfo | null>('detect_browser_for_extension')
      .then((result) => {
        if (!cancelled && result) setLaunch(result);
      })
      .catch(() => {
        // No supported browser found; the button falls back to "Open browser".
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Poll the local bridge while the wizard is open. The extension pings
  // /api/health as soon as its service worker starts, so this flips to green
  // right after the user finishes "Load unpacked" — no manual refresh needed.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const status = await invoke<BrowserIntegrationStatus>('get_browser_integration_status');
        if (cancelled) return;

        const isConnected = status.bridge?.extension_connected ?? false;
        setConnected(isConnected);

        if (!info && status.extension_setup_path) {
          setInfo({
            path: status.extension_setup_path,
            version: status.extension_version,
            copied: false,
          });
        }

        if (isConnected) {
          setCheckMessage(null);
          setStep(2);
        }
      } catch {
        // A transient failure while the app is starting is harmless; the next
        // poll will try again.
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOpen, info]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOpenFolder = async () => {
    setBusy('folder');
    setError(null);
    try {
      const result = await invoke<ExtensionSetupInfo>('open_extension_folder');
      setInfo(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const handleCopyPath = async () => {
    if (!info?.path) return;
    setBusy('copy');
    setError(null);
    try {
      await invoke('copy_text_to_clipboard', { text: info.path });
      flashCopied('path');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const handleOpenBrowser = async () => {
    setBusy('browser');
    setError(null);
    setCheckMessage(null);
    try {
      const result = await invoke<BrowserLaunchInfo>('open_browser_for_extension');
      setLaunch(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const handleCheckConnection = async () => {
    setBusy('check');
    setCheckMessage(null);
    setError(null);
    try {
      const status = await invoke<BrowserIntegrationStatus>('get_browser_integration_status');
      const isConnected = status.bridge?.extension_connected ?? false;
      setConnected(isConnected);
      if (isConnected) {
        setStep(2);
      } else {
        setCheckMessage(
          'Not detected yet. Make sure Developer mode is on, the extension is enabled, and Rheow is still running.'
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const extensionPath = info?.path ?? null;
  const extensionVersion = info?.version ?? '1.0.0';
  const address = launch?.extensions_url ?? 'chrome://extensions  ·  edge://extensions';
  const browserName = launch?.browser ?? 'your browser';
  const openLabel = launch ? `Open ${launch.browser}` : 'Open browser';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect your browser"
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs select-none"
    >
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative w-full max-w-[560px] max-h-[calc(100vh-24px)] bg-white border border-[#e5e5e5] rounded-[18px] shadow-2xl flex flex-col overflow-hidden z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <RheowLogo variant="tile-light" className="w-7 h-7 rounded-lg shadow-2xs" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#171717] tracking-tight truncate">
                Connect your browser
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] cursor-pointer shrink-0"
            title="Close (Esc)"
            aria-label="Close browser setup"
          >
            <X className="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 py-2.5 border-b border-[#f0f0f0] bg-[#fafafa]/60 flex items-center gap-2 shrink-0">
          {STEPS.map((entry, index) => {
            const isActive = step === entry.id;
            const isComplete = step > entry.id;
            return (
              <React.Fragment key={entry.id}>
                <div
                  className={`flex items-center gap-1.5 ${
                    isActive || isComplete ? 'text-[#171717]' : 'text-[#a3a3a3]'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold border ${
                      isComplete
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : isActive
                          ? 'bg-[#2563eb] border-[#2563eb] text-white'
                          : 'bg-white border-[#e5e5e5] text-[#a3a3a3]'
                    }`}
                  >
                    {isComplete ? <Check className="w-3 h-3 stroke-[3]" /> : entry.id}
                  </span>
                  <span className="text-[10px] font-medium whitespace-nowrap">{entry.label}</span>
                </div>
                {index < STEPS.length - 1 && (
                  <span className="flex-1 h-px bg-[#e5e5e5]" aria-hidden="true" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto min-h-[318px]">
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className={`${iconTile} w-8 h-8 bg-blue-50 border-blue-100 text-[#2563eb]`}>
                  <Globe className="w-4 h-4 stroke-[2]" />
                </div>
                <h3 className="text-sm font-semibold text-[#171717]">
                  Add Rheow to {browserName}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] font-mono text-[10px] text-[#525252] flex items-center select-text"
                  title={address}
                >
                  <span className="truncate">{address}</span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenBrowser}
                  disabled={busy === 'browser'}
                  className={`${primaryButton} shrink-0`}
                >
                  {busy === 'browser' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5 stroke-[2]" />
                  )}
                  {openLabel}
                </button>
              </div>

              <ol className="space-y-1.5 text-[11px] text-[#525252] leading-relaxed">
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Click <strong className="font-semibold text-[#171717]">{openLabel}</strong> to
                    jump to the extensions page.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Turn on{' '}
                    <strong className="font-semibold text-[#171717]">Developer mode</strong> in the
                    top-right corner.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-white border border-[#e5e5e5] text-[9px] font-semibold text-[#171717] flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Click <strong className="font-semibold text-[#171717]">Load unpacked</strong>,
                    then select or paste this extension folder:
                  </span>
                </li>
              </ol>

              <div className="rounded-xl border border-[#e5e5e5] bg-white p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-semibold text-[#737373] px-0.5">
                  <span>Extension folder</span>
                  <span className="font-mono text-[#a3a3a3]">v{extensionVersion}</span>
                </div>
                <div
                  className="w-full min-w-0 h-8 px-2.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] font-mono text-[10px] text-[#525252] flex items-center select-text"
                  title={extensionPath ?? undefined}
                >
                  <span className="truncate">{extensionPath ?? 'Preparing the extension folder…'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyPath}
                    disabled={!extensionPath || busy === 'copy'}
                    className={`${secondaryButton} flex-1`}
                  >
                    {copiedField === 'path' ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[2.4] text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 stroke-[2]" />
                        Copy path
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    disabled={busy === 'folder'}
                    className={`${secondaryButton} flex-1`}
                  >
                    {busy === 'folder' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="w-3.5 h-3.5 stroke-[2]" />
                    )}
                    Open folder
                  </button>
                </div>
              </div>

              <div
                className={`flex items-start gap-2 p-2.5 rounded-xl border text-[11px] leading-relaxed ${
                  connected
                    ? 'bg-emerald-50/80 border-emerald-200/70 text-emerald-800'
                    : 'bg-amber-50/80 border-amber-200/70 text-[#92400e]'
                }`}
              >
                {connected ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 animate-spin" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold">
                    {connected ? 'Extension connected' : 'Waiting for connection'}
                  </p>
                  <p className={connected ? 'text-emerald-700' : 'text-[#92400e]/90'}>
                    {connected
                      ? 'Rheow can now receive downloads from your browser.'
                      : 'This turns green automatically right after you click Load unpacked in your browser.'}
                  </p>
                </div>
              </div>

              {checkMessage && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[10px] leading-relaxed">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{checkMessage}</span>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <Check className="w-7 h-7 stroke-[2.6]" />
              </div>
              <h3 className="text-base font-semibold text-[#171717] mt-3">You're all set</h3>
              <p className="text-[11px] text-[#737373] leading-relaxed mt-1.5 max-w-[360px]">
                The Rheow extension is connected. Downloads you start in {browserName} will be
                handed to Rheow automatically, with full multi-threaded speed.
              </p>

              <p className="text-[10px] text-[#737373] leading-relaxed mt-4">
                You can reopen this wizard any time from{' '}
                <strong className="font-semibold text-[#525252]">Settings → Browser</strong>.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-start gap-2 p-2.5 rounded-xl bg-red-50/80 border border-red-200/60 text-red-700 text-[11px]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-[#f0f0f0] bg-[#fafafa] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[#737373] hover:text-[#171717] hover:underline cursor-pointer"
          >
            {step === 2 ? 'Close' : 'Later'}
          </button>

          <div className="flex items-center gap-2">
            {step === 1 ? (
              <button
                type="button"
                onClick={handleCheckConnection}
                disabled={busy === 'check'}
                className={primaryButton}
              >
                {busy === 'check' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 stroke-[2]" />
                )}
                Check connection
              </button>
            ) : (
              <button type="button" onClick={onClose} className={primaryButton}>
                Done
                <Check className="w-3.5 h-3.5 stroke-[2.6]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
