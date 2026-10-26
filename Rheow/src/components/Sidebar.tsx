import React, { useState, useEffect } from 'react';
import {
  FolderArchive,
  Archive,
  Terminal,
  Film,
  FileText,
  Music,
  HardDrive,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadCategory } from '../types/download';

export interface PartitionInfo {
  letter: string;
  name: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  free_display: string;
  used_display: string;
  usage_percentage: number;
}

interface SidebarProps {
  selectedCategory: DownloadCategory;
  onSelectCategory: (category: DownloadCategory) => void;
  counts: Record<string, number>;
  activeConnections?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  counts,
}) => {
  const [partitions, setPartitions] = useState<PartitionInfo[]>([
    {
      letter: 'C:',
      name: 'Local SSD (C:)',
      total_bytes: 1_000_000_000_000,
      free_bytes: 348_000_000_000,
      used_bytes: 652_000_000_000,
      free_display: '348 GB free',
      used_display: '652 GB / 1.0 TB used',
      usage_percentage: 65.2,
    },
  ]);

  useEffect(() => {
    const fetchPartitions = async () => {
      try {
        const detected = await invoke<PartitionInfo[]>('get_partitions');
        if (detected && detected.length > 0) {
          setPartitions(detected);
        }
      } catch (err) {
        console.error('Failed to fetch system partitions:', err);
      }
    };

    fetchPartitions();
    const interval = setInterval(fetchPartitions, 15000);
    return () => clearInterval(interval);
  }, []);

  const categories = [
    {
      id: 'All' as DownloadCategory,
      label: 'All Downloads',
      icon: FolderArchive,
      iconColor: '#171717',
      count: counts.All ?? 28,
    },
    {
      id: 'Compressed' as DownloadCategory,
      label: 'Compressed',
      icon: Archive,
      iconColor: '#7c3aed',
      count: counts.Compressed ?? 8,
    },
    {
      id: 'Programs' as DownloadCategory,
      label: 'Programs & Apps',
      icon: Terminal,
      iconColor: '#2563eb',
      count: counts.Programs ?? 6,
    },
    {
      id: 'Video' as DownloadCategory,
      label: 'Video & Media',
      icon: Film,
      iconColor: '#ea580c',
      count: counts.Video ?? 7,
    },
    {
      id: 'Documents' as DownloadCategory,
      label: 'Documents',
      icon: FileText,
      iconColor: '#16a34a',
      count: counts.Documents ?? 4,
    },
    {
      id: 'Music' as DownloadCategory,
      label: 'Music & Audio',
      icon: Music,
      iconColor: '#0891b2',
      count: counts.Music ?? 3,
    },
  ];

  return (
    <aside className="w-[215px] lg:w-[250px] shrink-0 border-r border-[#e5e5e5] bg-white flex flex-col justify-between py-4 px-2.5 sm:px-3 select-none h-full overflow-hidden transition-[width] duration-200">
      {/* Top Nav Content */}
      <div className="flex flex-col gap-3 sm:gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <div className="px-2 text-[11px] font-semibold text-[#737373] tracking-[0.5px] uppercase">
            CATEGORIES
          </div>

          <div className="flex flex-col gap-1 mt-1">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;

              return (
                <button
                  key={cat.id}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`w-full h-[36px] px-2 rounded-lg flex items-center justify-between text-xs lg:text-[13px] transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#f5f5f5] text-[#171717] font-semibold'
                      : 'text-[#262626] hover:bg-[#f5f5f5]/80 font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-[26px] h-[26px] rounded-[6px] flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-white border border-[#e5e5e5] shadow-2xs'
                          : 'bg-[#f5f5f5]'
                      }`}
                    >
                      <Icon
                        className="w-3.5 h-3.5 shrink-0 stroke-[2]"
                        style={{ color: cat.iconColor }}
                      />
                    </div>
                    <span className="truncate">{cat.label}</span>
                  </div>

                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-mono font-medium rounded-full border border-[#e5e5e5] shrink-0 ${
                      isSelected
                        ? 'bg-white text-[#171717]'
                        : 'bg-[#f5f5f5] text-[#737373]'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sidebar Divider */}
        <div className="h-[1px] w-full bg-[#e5e5e5]" />
      </div>

      {/* Auto-detected Partition Cards at the Bottom (Protected from vertical overflow) */}
      <div className="flex flex-col gap-2.5 pt-2.5 shrink-0 max-h-[200px] overflow-y-auto pr-0.5">
        {partitions.map((part) => (
          <div
            key={part.letter}
            className="p-2.5 lg:p-3 bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl flex flex-col gap-2 shrink-0"
          >
            {/* Header: Drive Name & Free Space */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <HardDrive className="w-[13px] h-[13px] text-[#171717] stroke-[2] shrink-0" />
                <span className="text-[11px] lg:text-xs font-semibold text-[#171717] truncate">
                  {part.name}
                </span>
              </div>
              <span className="text-[10px] lg:text-[11px] font-mono text-[#737373] shrink-0">
                {part.free_display}
              </span>
            </div>

            {/* Storage Progress Bar */}
            <div className="w-full h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#171717] rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, part.usage_percentage))}%` }}
              />
            </div>

            {/* Footer Capacity Info */}
            <div className="flex items-center justify-between text-[9px] lg:text-[10px] text-[#525252]">
              <span>{part.used_display}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
