import React, { useEffect } from 'react';
import { AlertTriangle, DownloadCloud, Pause, X } from 'lucide-react';
import type { UpdateState } from '../types/updater';

interface UpdateInstallDialogProps {
  isOpen: boolean;
  state: UpdateState | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const UpdateInstallDialog: React.FC<UpdateInstallDialogProps> = ({
  isOpen,
  state,
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !state?.info) return null;

  const active = state.activeDownloads;
  const countLabel = `${active} active download${active === 1 ? '' : 's'}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-install-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[460px] bg-white border border-[#e5e5e5] rounded-[18px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden z-10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
              <AlertTriangle className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div>
              <h2 id="update-install-title" className="text-sm font-semibold text-[#171717] tracking-tight">
                Downloads are still active
              </h2>
              <p className="text-[11px] text-[#737373] mt-0.5">
                Rheow {state.info.version} is ready to install
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            aria-label="Close update dialog"
            title="Close (Esc)"
          >
            <X className="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-[#525252] leading-relaxed">
            {active > 0
              ? `${countLabel} will be paused so Windows can replace Rheow's files.`
              : 'Windows will replace Rheow\'s files and restart the app.'}
          </p>
          <div className="flex items-start gap-2.5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-3">
            <Pause className="w-4 h-4 text-[#2563eb] stroke-[2.2] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#525252] leading-relaxed">
              Your progress is saved in the database. A backup is created before the installer runs,
              and paused downloads can be resumed after Rheow restarts.
            </p>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#f0f0f0] bg-[#fafafa]/60 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-[#e5e5e5] bg-white text-xs font-medium text-[#525252] hover:bg-[#f5f5f5] cursor-pointer"
          >
            Later
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-2 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8] cursor-pointer flex items-center gap-1.5"
          >
            <DownloadCloud className="w-3.5 h-3.5 stroke-[2.2]" />
            {active > 0 ? 'Pause All & Install' : 'Install now'}
          </button>
        </div>
      </div>
    </div>
  );
};
