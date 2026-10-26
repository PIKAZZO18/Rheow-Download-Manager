import React from 'react';
import { Search } from 'lucide-react';

interface FilterToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  counts: {
    all: number;
    downloading: number;
    completed: number;
    paused: number;
    queued: number;
  };
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  counts,
}) => {
  const filters = [
    { id: 'all', label: `All ${counts.all}`, dot: null },
    { id: 'downloading', label: `Downloading ${counts.downloading}`, dot: 'bg-[#2563eb]' },
    { id: 'completed', label: `Completed ${counts.completed}`, dot: 'bg-[#16a34a]' },
    { id: 'paused', label: `Paused ${counts.paused}`, dot: 'bg-[#ea580c]' },
    { id: 'queued', label: `Queued ${counts.queued}`, dot: 'bg-[#7c3aed]' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 select-none">
      {/* Search Input Field (Adapts smoothly from compact window to full screen) */}
      <div className="w-full sm:w-[220px] md:w-[260px] lg:w-[320px] h-[29px] bg-white border border-black rounded-[6px] px-2.5 flex items-center gap-2 shadow-2xs transition-all shrink-0">
        <Search className="w-3.5 h-3.5 text-[#737373] shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files, URLs, domains..."
          className="w-full text-xs text-[#171717] placeholder-[#737373] bg-transparent focus:outline-none"
        />
      </div>

      {/* Filter Tabs Cluster */}
      <div className="flex items-center gap-1.5 py-0.5 shrink-0">
        {filters.map((f) => {
          const isActive = statusFilter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onStatusFilterChange(f.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-[#171717] border border-[#171717] text-white font-semibold'
                  : 'bg-white border border-[#e5e5e5] text-[#525252] hover:text-[#171717] hover:bg-neutral-50 font-medium'
              }`}
            >
              {f.dot && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.dot}`} />
              )}
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
