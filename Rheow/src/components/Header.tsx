import React, { useState, useEffect, useRef } from 'react';
import { Pause, Play, Plus, ListPlus } from 'lucide-react';
import { RheowLogo } from './brand/RheowLogo';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddClick: () => void;
  onAddBatchClick?: () => void;
  isAllPaused: boolean;
  onTogglePauseResumeAll: () => void;
  queueCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onAddClick,
  onAddBatchClick,
  isAllPaused,
  onTogglePauseResumeAll,
  queueCount = 3,
}) => {
  const tabs = [
    { id: 'downloads', label: 'Downloads' },
    { id: 'queues', label: 'Queues', badge: queueCount },
    { id: 'scheduler', label: 'Scheduler' },
    { id: 'grabber', label: 'Site Grabber' },
    { id: 'settings', label: 'Settings' },
  ];

  const [activeRect, setActiveRect] = useState<{ left: number; width: number; height: number; top: number } | null>(null);
  const [hoverRect, setHoverRect] = useState<{ left: number; width: number; height: number; top: number } | null>(null);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Measure and position active sliding pill
  useEffect(() => {
    const updateActiveRect = () => {
      const activeEl = tabRefs.current.get(activeTab);
      const navEl = navRef.current;
      if (activeEl && navEl) {
        const navRect = navEl.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        setActiveRect({
          left: elRect.left - navRect.left + navEl.scrollLeft,
          width: elRect.width,
          height: elRect.height,
          top: elRect.top - navRect.top,
        });
      }
    };

    updateActiveRect();
    window.addEventListener('resize', updateActiveRect);
    return () => window.removeEventListener('resize', updateActiveRect);
  }, [activeTab]);

  // Measure and position hover sliding indicator
  useEffect(() => {
    if (!hoveredTab || hoveredTab === activeTab) {
      setHoverRect(null);
      return;
    }
    const hoverEl = tabRefs.current.get(hoveredTab);
    const navEl = navRef.current;
    if (hoverEl && navEl) {
      const navRect = navEl.getBoundingClientRect();
      const elRect = hoverEl.getBoundingClientRect();
      setHoverRect({
        left: elRect.left - navRect.left + navEl.scrollLeft,
        width: elRect.width,
        height: elRect.height,
        top: elRect.top - navRect.top,
      });
    }
  }, [hoveredTab, activeTab]);

  return (
    <header className="h-14 border-b border-[#e5e5e5] bg-white flex items-center justify-between px-4 sm:px-6 select-none shrink-0 gap-3">
      {/* Brand Cluster with smooth interactive micro-bounce */}
      <div className="group flex items-center gap-2.5 sm:gap-3 shrink-0 cursor-default">
        <RheowLogo
          variant="tile-light"
          className="w-7 h-7 group-hover:scale-105 group-hover:-translate-y-0.5 group-active:scale-95 group-active:translate-y-0 transition-all duration-200"
          title="Rheow Download Manager"
        />
        <span className="text-[15px] sm:text-base font-semibold text-[#171717] tracking-tight">
          Rheow
        </span>
      </div>

      {/* Nav Links with High-End Fluid Sliding Pill & Magnetic Hover Feedback */}
      <nav
        ref={navRef}
        onMouseLeave={() => setHoveredTab(null)}
        className="relative flex items-center gap-0.5 sm:gap-1 py-1 px-1 shrink-0"
      >
        {/* Soft Hover Indicator (Glides between hovered inactive tabs) */}
        {hoverRect && (
          <span
            className="absolute rounded-full bg-neutral-100/80 border border-neutral-200/40 pointer-events-none transition-all duration-200 ease-out"
            style={{
              left: `${hoverRect.left}px`,
              top: `${hoverRect.top}px`,
              width: `${hoverRect.width}px`,
              height: `${hoverRect.height}px`,
            }}
          />
        )}

        {/* Active Sliding Pill (Glides with physical spring curve between active tabs) */}
        {activeRect && (
          <span
            className="absolute rounded-full bg-[#f5f5f5] border border-neutral-200/50 shadow-2xs pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              left: `${activeRect.left}px`,
              top: `${activeRect.top}px`,
              width: `${activeRect.width}px`,
              height: `${activeRect.height}px`,
            }}
          />
        )}

        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              onClick={() => onTabChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              className={`group relative z-10 flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs sm:text-[13px] whitespace-nowrap transition-transform duration-150 active:scale-95 cursor-pointer ${
                isActive
                  ? 'text-[#171717] font-semibold'
                  : 'text-[#525252] hover:text-[#171717] font-medium'
              }`}
            >
              <span className="transition-colors duration-150">{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`px-[5px] py-[1px] text-[10px] rounded-full font-mono transition-all duration-200 group-hover:scale-105 group-active:scale-95 ${
                    isActive
                      ? 'bg-[#e5e5e5] text-[#171717] font-semibold'
                      : 'bg-neutral-200/70 text-[#525252]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Header Right Actions */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Pause All / Resume All Toggle Button with Smooth Animation & Symmetrical Layout */}
        <button
          onClick={onTogglePauseResumeAll}
          title={isAllPaused ? 'Resume all downloads' : 'Pause all active downloads'}
          className={`group relative overflow-hidden flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs sm:text-[13px] font-medium rounded-lg border transition-all duration-200 active:scale-95 cursor-pointer shadow-2xs hover:shadow-xs ${
            isAllPaused
              ? 'bg-blue-50/80 hover:bg-blue-50 border-blue-200 hover:border-blue-300 text-[#2563eb]'
              : 'bg-white hover:bg-[#f5f5f5] border-[#e5e5e5] hover:border-neutral-300 text-[#171717]'
          }`}
        >
          {/* Animated Icon Swap */}
          <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
            <Pause
              className={`w-3.5 h-3.5 absolute inset-0 m-auto transition-all duration-300 ease-out transform stroke-[2.2] ${
                isAllPaused
                  ? 'opacity-0 scale-50 rotate-90 pointer-events-none'
                  : 'opacity-100 scale-100 rotate-0 text-[#171717]'
              }`}
            />
            <Play
              className={`w-3.5 h-3.5 absolute inset-0 m-auto transition-all duration-300 ease-out transform fill-current ${
                isAllPaused
                  ? 'opacity-100 scale-100 rotate-0 text-[#2563eb]'
                  : 'opacity-0 scale-50 -rotate-90 pointer-events-none'
              }`}
            />
          </div>

          {/* Animated Text Swap (Mathematically Symmetrical & Centered) */}
          <div className="relative h-4 overflow-hidden w-[68px] sm:w-[74px] select-none flex items-center justify-center">
            <span
              className={`absolute inset-0 flex items-center justify-center text-center transition-all duration-300 ease-out transform ${
                isAllPaused
                  ? '-translate-y-full opacity-0 pointer-events-none'
                  : 'translate-y-0 opacity-100'
              }`}
            >
              Pause All
            </span>
            <span
              className={`absolute inset-0 flex items-center justify-center text-center transition-all duration-300 ease-out transform ${
                isAllPaused
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-full opacity-0 pointer-events-none'
              }`}
            >
              Resume All
            </span>
          </div>
        </button>

        {/* Add Batch Button */}
        {onAddBatchClick && (
          <button
            type="button"
            onClick={onAddBatchClick}
            title="Import Multiple URLs (Batch)"
            className="group flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-[13px] font-medium text-[#171717] bg-white hover:bg-[#f5f5f5] border border-[#e5e5e5] hover:border-neutral-300 rounded-lg shadow-2xs hover:shadow-xs active:scale-95 transition-all duration-200 cursor-pointer whitespace-nowrap"
          >
            <ListPlus className="w-3.5 h-3.5 stroke-[2] text-[#2563eb]" />
            <span>Add Batch</span>
          </button>
        )}

        {/* Add URL Button with Delightful Micro-Spin on Hover & Spring Press */}
        <button
          onClick={onAddClick}
          className="group flex items-center gap-1.5 px-3 sm:px-3.5 py-[7px] text-xs sm:text-[13px] font-medium text-white bg-black hover:bg-neutral-800 active:scale-95 rounded-lg shadow-xs hover:shadow-md hover:shadow-black/15 transition-all duration-200 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-90 group-active:scale-90" />
          <span>Add URL</span>
        </button>
      </div>
    </header>
  );
};
