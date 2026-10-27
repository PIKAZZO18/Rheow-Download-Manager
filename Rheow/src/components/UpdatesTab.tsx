import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { UpdateState, UpdaterSettings } from '../types/updater';
import { formatBytes } from '../utils/format';

interface UpdatesTabProps {
  state: UpdateState | null;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onSaveSettings: (settings: UpdaterSettings) => Promise<void>;
}

function formatCheckedAt(value?: string | null): string {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const phaseLabel = (state: UpdateState): string => {
  switch (state.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'upToDate':
      return "You're up to date";
    case 'available':
      return `Version ${state.info?.version ?? ''} is available`;
    case 'downloading':
      return `Downloading ${state.info?.version ?? 'update'}…`;
    case 'ready':
      return `Version ${state.info?.version ?? ''} is ready to install`;
    case 'needsPause':
      return 'Pause active downloads to continue';
    case 'installing':
      return 'Installing… Rheow will restart';
    case 'error':
      return 'Update failed';
    default:
      return 'Automatic update checks are enabled';
  }
};

export const UpdatesTab: React.FC<UpdatesTabProps> = ({
  state,
  onCheck,
  onDownload,
  onInstall,
  onSaveSettings,
}) => {
  const [savingToggle, setSavingToggle] = useState(false);

  if (!state) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl border border-[#e5e5e5] bg-[#fafafa] text-[11px] text-[#737373]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading update status…
      </div>
    );
  }

  const busy =
    state.phase === 'checking' ||
    state.phase === 'downloading' ||
    state.phase === 'installing';
  const canCheck = !busy && state.phase !== 'ready' && state.phase !== 'needsPause';
  const hasInfo = Boolean(state.info);
  const isReady = state.phase === 'ready' || state.phase === 'needsPause';

  const handleToggle = async (checked: boolean) => {
    setSavingToggle(true);
    try {
      await onSaveSettings({ ...state.settings, autoCheck: checked });
    } finally {
      setSavingToggle(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#171717]">Rheow {state.currentVersion}</p>
            <p className="text-[11px] text-[#737373] mt-0.5">{phaseLabel(state)}</p>
          </div>
          <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-white border border-[#e5e5e5] text-[#525252] shrink-0">
            Stable
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCheck}
            disabled={!canCheck}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {state.phase === 'checking' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 stroke-[2.2]" />
            )}
            {state.phase === 'checking' ? 'Checking…' : 'Check now'}
          </button>

          {state.phase === 'available' && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white text-xs font-semibold text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            >
              <DownloadCloud className="w-3.5 h-3.5 stroke-[2.2]" />
              Download
            </button>
          )}

          {isReady && (
            <button
              type="button"
              onClick={onInstall}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white text-xs font-semibold text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            >
              <DownloadCloud className="w-3.5 h-3.5 stroke-[2.2]" />
              Install now
            </button>
          )}

          {state.phase === 'error' && hasInfo && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white text-xs font-semibold text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            >
              <DownloadCloud className="w-3.5 h-3.5 stroke-[2.2]" />
              Download again
            </button>
          )}
        </div>

        <p className="text-[10px] text-[#737373]">
          Last checked: {formatCheckedAt(state.settings.lastCheckAt)}
        </p>
      </div>

      <label className="flex items-center justify-between p-3.5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] cursor-pointer hover:bg-neutral-100/50 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100/80 flex items-center justify-center text-[#2563eb] shrink-0">
            <RefreshCw className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <p className="font-medium text-xs text-[#171717]">Check for updates automatically</p>
            <p className="text-[10px] text-[#737373] mt-0.5">
              At startup and every 24 hours. Rheow never installs an update without asking.
            </p>
          </div>
        </div>
        <input
          type="checkbox"
          checked={state.settings.autoCheck}
          disabled={savingToggle}
          onChange={(event) => void handleToggle(event.target.checked)}
          className="w-4 h-4 rounded text-black focus:ring-black accent-[#171717] cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      {state.phase === 'downloading' && state.progress && (
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-[#171717]">Downloading update</span>
            <span className="font-mono text-[#2563eb]">
              {Math.round(state.progress.percent)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#f5f5f5] border border-[#e5e5e5] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2563eb] rounded-full transition-[width] duration-200"
              style={{ width: `${Math.min(100, Math.max(0, state.progress.percent))}%` }}
            />
          </div>
          <p className="text-[10px] text-[#737373] font-mono">
            {formatBytes(state.progress.downloaded)}
            {state.progress.total ? ` / ${formatBytes(state.progress.total)}` : ''}
          </p>
        </div>
      )}

      {hasInfo && state.info && (
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#171717]">
              What's new in {state.info.version}
            </p>
            {state.info.publishedAt && (
              <span className="text-[10px] text-[#737373]">
                {new Date(state.info.publishedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#525252] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto rheow-scrollbar">
            {state.info.notes.trim() || 'No release notes were provided for this version.'}
          </p>
        </div>
      )}

      {state.phase === 'error' && state.error && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-50/80 border border-red-200/60 text-red-700 text-[11px]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{state.error}</span>
        </div>
      )}

      {state.phase === 'upToDate' && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/60 text-emerald-700 text-[11px]">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Rheow {state.currentVersion} is the latest stable version.</span>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-3">
        <ShieldCheck className="w-4 h-4 text-[#16a34a] stroke-[2.2] shrink-0 mt-0.5" />
        <p className="text-[10px] text-[#737373] leading-relaxed">
          Updates are verified with Rheow's signing key before they run. A database backup is created
          in <span className="font-mono">%APPDATA%\Rheow\backups</span> before every install.
        </p>
      </div>
    </div>
  );
};
