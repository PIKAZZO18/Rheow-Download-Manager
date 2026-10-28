import React, { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { plainReleaseNotes } from '../utils/releaseNotes';

interface UpdateNotesDialogProps {
  isOpen: boolean;
  version: string;
  notes: string;
  onClose: () => void;
}

export const UpdateNotesDialog: React.FC<UpdateNotesDialogProps> = ({
  isOpen,
  version,
  notes,
  onClose,
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

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-notes-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[480px] bg-white border border-[#e5e5e5] rounded-[18px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden z-10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f0f0] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#2563eb] shrink-0 shadow-2xs">
              <Sparkles className="w-4 h-4 stroke-[2.2]" />
            </div>
            <h2
              id="update-notes-title"
              className="text-sm font-semibold text-[#171717] tracking-tight"
            >
              What's new in Rheow {version}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] cursor-pointer"
            aria-label="Close release notes"
            title="Close (Esc)"
          >
            <X className="w-4 h-4 stroke-[2.2]" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[11px] leading-relaxed text-[#525252] whitespace-pre-wrap max-h-[320px] overflow-y-auto rheow-scrollbar">
            {plainReleaseNotes(notes) || 'No release notes were provided for this version.'}
          </p>
        </div>

        <div className="px-5 py-3.5 border-t border-[#f0f0f0] bg-[#fafafa]/60 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8] cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
