import React from 'react';
import { Play, Pause, Plus, ListOrdered } from 'lucide-react';
import type { QueueDetails } from '../types/settings';

interface QueueControlBarProps {
  queueDetails: QueueDetails;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onMaxConcurrentChange: (count: number) => void;
  onAddDownloadClick?: () => void;
}

export const QueueControlBar: React.FC<QueueControlBarProps> = ({
  queueDetails,
  onStartQueue,
  onPauseQueue,
  onMaxConcurrentChange,
  onAddDownloadClick,
}) => {
  const { isRunning, activeCount, queuedCount, maxConcurrent } = queueDetails;

  return (
    <div className="w-full bg-[#fafafa] border border-[#e5e5e5] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs select-none">
      {/* Left: Queue Status & Counters */}
      <div className="flex items-center gap-3">
        {/* Status Pill */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-tight transition-colors ${
            isRunning
              ? 'bg-[#dcfce7] border border-[#86efac] text-[#15803d]'
              : 'bg-[#f5f5f5] border border-[#e5e5e5] text-[#737373]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-[#16a34a] animate-pulse' : 'bg-[#a3a3a3]'
            }`}
          />
          <span>{isRunning ? 'Queue Running' : 'Queue Idle'}</span>
        </div>

        {/* Stats summary */}
        <div className="flex items-center gap-2 text-xs text-[#525252]">
          <span className="flex items-center gap-1 font-medium">
            <ListOrdered className="w-3.5 h-3.5 text-[#737373]" />
            <strong className="text-[#171717]">{queuedCount}</strong> waiting
          </span>
          <span className="text-[#d4d4d4]">/</span>
          <span className="flex items-center gap-1 font-medium">
            <strong className="text-[#171717]">{activeCount}</strong> downloading
          </span>
        </div>
      </div>

      {/* Right: Concurrency Setting & Queue Action Controls */}
      <div className="flex items-center gap-2.5">
        {/* Concurrency Selector */}
        <div className="flex items-center gap-1.5 bg-white border border-[#e5e5e5] rounded-lg px-2.5 py-1 text-xs">
          <span className="text-[#737373] text-[11px] font-medium">Concurrency:</span>
          <select
            value={maxConcurrent}
            onChange={(e) => onMaxConcurrentChange(Number(e.target.value))}
            aria-label="Queue concurrency"
            className="bg-transparent text-[#171717] font-semibold text-xs outline-none cursor-pointer"
          >
            {[1, 2, 3, 4, 5, 6, 8, 10].map((num) => (
              <option key={num} value={num}>
                {num} {num === 1 ? 'file' : 'files'}
              </option>
            ))}
          </select>
        </div>

        {/* Add download shortcut */}
        {onAddDownloadClick && (
          <button
            type="button"
            onClick={onAddDownloadClick}
            className="h-7 px-2.5 rounded-lg bg-white border border-[#e5e5e5] hover:bg-neutral-50 text-[#171717] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Add new download"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Download</span>
          </button>
        )}

        {/* Start / Pause Queue Toggle Button */}
        {isRunning ? (
          <button
            type="button"
            onClick={onPauseQueue}
            className="h-7 px-3 rounded-lg bg-[#ea580c] hover:bg-[#c2410c] text-white text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all shadow-2xs cursor-pointer"
            title="Pause queue processing"
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
            <span>Pause Queue</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartQueue}
            className="h-7 px-3.5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] text-white text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-all shadow-2xs cursor-pointer"
            title="Start processing queued downloads"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start Queue</span>
          </button>
        )}
      </div>
    </div>
  );
};
