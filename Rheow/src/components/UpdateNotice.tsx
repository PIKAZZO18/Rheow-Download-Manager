import React from 'react';
import { ArrowUpRight, Sparkles, X } from 'lucide-react';
import type { UpdateState } from '../types/updater';
import { plainReleaseNotes } from '../utils/releaseNotes';

interface UpdateNoticeProps {
  state: UpdateState;
  onOpen: () => void;
  onDismiss: () => void;
}

export const UpdateNotice: React.FC<UpdateNoticeProps> = ({ state, onOpen, onDismiss }) => {
  const { info } = state;
  if (!info) return null;

  const notes =
    plainReleaseNotes(info.notes) || 'No release notes were provided for this version.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-40 w-[340px] max-w-[calc(100vw-2.5rem)] animate-update-notice-in motion-reduce:animate-none"
    >
      <div className="relative bg-white border border-[#e5e5e5] rounded-2xl shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)] overflow-hidden">
        <button
          type="button"
          onClick={onOpen}
          className="group block w-full text-left px-4 pt-3.5 pb-3 cursor-pointer hover:bg-[#fafafa] transition-colors"
          aria-label={`View Rheow ${info.version} release notes`}
        >
          <div className="flex items-center gap-2.5 pr-7">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100/80 flex items-center justify-center text-[#2563eb] shrink-0">
              <Sparkles className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#171717]">Update available</p>
              <p className="text-[11px] text-[#737373] mt-0.5">Rheow {info.version}</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#525252] whitespace-pre-wrap line-clamp-4">
            {notes}
          </p>

          <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563eb] group-hover:text-[#1d4ed8]">
            Release notes
            <ArrowUpRight className="w-3 h-3 stroke-[2.4]" />
          </span>
        </button>

        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-[#a3a3a3] hover:text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
          aria-label="Dismiss update notice"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5 stroke-[2.2]" />
        </button>
      </div>
    </div>
  );
};
