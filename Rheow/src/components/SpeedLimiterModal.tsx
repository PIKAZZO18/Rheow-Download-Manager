import React, { useState, useEffect, useRef } from 'react';
import { Gauge, X, AlertTriangle, Check, ChevronDown, Zap } from 'lucide-react';

export interface SpeedLimiterSettings {
  speedLimit: number;
  unit: 'KBytes/sec' | 'MBytes/sec';
  alwaysOnStartup: boolean;
  enabled: boolean;
}

interface SpeedLimiterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (settings: SpeedLimiterSettings, removeLimit?: boolean) => void;
  initialSettings?: Partial<SpeedLimiterSettings>;
  targetFileName?: string;
  hasActiveLimit?: boolean;
}

const UNIT_OPTIONS: Array<{ id: 'KBytes/sec' | 'MBytes/sec'; label: string; desc: string }> = [
  { id: 'KBytes/sec', label: 'KBytes/sec', desc: 'Kilobytes per second' },
  { id: 'MBytes/sec', label: 'MBytes/sec', desc: 'Megabytes per second' },
];

const SPEED_PRESETS = [
  { label: '256 KB/s', value: 256, unit: 'KBytes/sec' as const },
  { label: '512 KB/s', value: 512, unit: 'KBytes/sec' as const },
  { label: '1 MB/s', value: 1, unit: 'MBytes/sec' as const },
  { label: '2 MB/s', value: 2, unit: 'MBytes/sec' as const },
  { label: '5 MB/s', value: 5, unit: 'MBytes/sec' as const },
  { label: '10 MB/s', value: 10, unit: 'MBytes/sec' as const },
];

export const SpeedLimiterModal: React.FC<SpeedLimiterModalProps> = ({
  isOpen,
  onClose,
  onApply,
  initialSettings,
  targetFileName,
  hasActiveLimit = false,
}) => {
  const [speedLimit, setSpeedLimit] = useState<string>(
    initialSettings?.speedLimit ? String(initialSettings.speedLimit) : '500'
  );
  const [unit, setUnit] = useState<'KBytes/sec' | 'MBytes/sec'>(
    initialSettings?.unit || 'KBytes/sec'
  );
  const [alwaysOnStartup, setAlwaysOnStartup] = useState<boolean>(
    initialSettings?.alwaysOnStartup ?? true
  );
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialSettings?.speedLimit !== undefined) {
        setSpeedLimit(String(initialSettings.speedLimit));
      }
      if (initialSettings?.unit) {
        setUnit(initialSettings.unit);
      }
      if (initialSettings?.alwaysOnStartup !== undefined) {
        setAlwaysOnStartup(initialSettings.alwaysOnStartup);
      }
      setIsUnitDropdownOpen(false);

      // Auto-focus input
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialSettings]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsUnitDropdownOpen(false);
      }
    };
    if (isUnitDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUnitDropdownOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (isUnitDropdownOpen) {
          setIsUnitDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isUnitDropdownOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = () => {
    const num = parseFloat(speedLimit);
    const validNum = isNaN(num) || num <= 0 ? 500 : num;
    onApply({
      speedLimit: validNum,
      unit,
      alwaysOnStartup,
      enabled: true,
    });
    onClose();
  };

  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleSelectPreset = (presetVal: number, presetUnit: 'KBytes/sec' | 'MBytes/sec') => {
    setSpeedLimit(String(presetVal));
    setUnit(presetUnit);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-[580px] bg-white border border-[#e5e5e5] rounded-2xl shadow-[0_16px_32px_rgba(0,0,0,0.12)] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 flex flex-col">
        {/* Window Title Bar */}
        <div className="h-12 bg-[#f5f5f5] border-b border-[#e5e5e5] px-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-md bg-[#171717] flex items-center justify-center text-white shrink-0 shadow-2xs">
              <Gauge className="w-3.5 h-3.5 stroke-[2.2]" />
            </div>
            <span className="text-[13px] font-semibold text-[#171717] tracking-tight truncate">
              {targetFileName ? `Speed Limiter — ${targetFileName}` : 'Speed Limiter Settings'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[#525252] hover:text-[#171717] hover:bg-neutral-200/60 active:scale-95 transition-all cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* Dialog Content Body */}
        <div className="p-5 sm:p-6 flex flex-col gap-4 bg-white">
          {/* Speed Limit Input Group */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
              <label
                htmlFor="speed-limit-input"
                className="text-sm font-semibold text-[#171717] cursor-pointer whitespace-nowrap"
              >
                Maximum download speed:
              </label>

              <div className="flex items-center gap-2 shrink-0">
                {/* Numeric Speed Input */}
                <input
                  id="speed-limit-input"
                  ref={inputRef}
                  type="number"
                  min="1"
                  step="any"
                  value={speedLimit}
                  onChange={(e) => setSpeedLimit(e.target.value)}
                  onKeyDown={handleKeyDownInput}
                  placeholder="500"
                  className="w-24 sm:w-28 h-10 px-3 bg-white border border-[#d4d4d4] hover:border-[#a3a3a3] focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15 rounded-lg text-sm font-mono font-semibold text-[#171717] outline-none transition-all"
                />

                {/* Custom Unit Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)}
                    className={`w-32 sm:w-36 h-10 px-3 bg-white border rounded-lg flex items-center justify-between text-[13px] font-medium text-[#171717] transition-all cursor-pointer select-none ${
                      isUnitDropdownOpen
                        ? 'border-[#2563eb] ring-2 ring-[#2563eb]/15 shadow-xs'
                        : 'border-[#d4d4d4] hover:border-[#a3a3a3]'
                    }`}
                  >
                    <span>{unit}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#737373] transition-transform duration-200 ${
                        isUnitDropdownOpen ? 'rotate-180 text-[#2563eb]' : ''
                      }`}
                    />
                  </button>

                  {isUnitDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-[#e5e5e5] rounded-xl shadow-lg p-1 z-20 animate-in fade-in slide-in-from-top-1 duration-150">
                      {UNIT_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setUnit(opt.id);
                            setIsUnitDropdownOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-lg flex flex-col text-left transition-colors cursor-pointer ${
                            unit === opt.id
                              ? 'bg-[#2563eb] text-white font-semibold shadow-2xs'
                              : 'text-[#171717] hover:bg-[#f5f5f5]'
                          }`}
                        >
                          <span className="text-xs font-semibold">{opt.label}</span>
                          <span
                            className={`text-[10px] ${
                              unit === opt.id ? 'text-white/80' : 'text-[#737373]'
                            }`}
                          >
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Speed Preset Pills */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] font-medium text-[#737373] mr-1 flex items-center gap-1">
                <Zap className="w-3 h-3 text-[#2563eb]" />
                Presets:
              </span>
              {SPEED_PRESETS.map((preset) => {
                const isSelected =
                  parseFloat(speedLimit) === preset.value && unit === preset.unit;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleSelectPreset(preset.value, preset.unit)}
                    className={`px-2.5 py-1 text-xs font-mono rounded-lg transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#2563eb] text-white font-semibold shadow-2xs'
                        : 'bg-[#f5f5f5] hover:bg-[#e5e5e5] text-[#171717] font-medium'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Server Advisory Card */}
          <div className="bg-[#fffbeb] border border-[#fde68a] rounded-xl p-3 sm:p-3.5 flex items-start gap-2.5 shadow-2xs">
            <AlertTriangle className="w-4 h-4 text-[#d97706] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs font-semibold text-[#92400e]">
                Low Speed Connection Advisory
              </span>
              <p className="text-[11px] leading-relaxed text-[#b45309]">
                Remote servers may timeout or drop connections when bandwidth is severely throttled.
                For files on hosts without resume support, maintaining at least 64 KB/s is recommended.
              </p>
            </div>
          </div>
        </div>

        {/* Dialog Footer Bar */}
        <div className="h-[60px] bg-[#f5f5f5] border-t border-[#e5e5e5] px-5 sm:px-6 flex items-center justify-between gap-3 shrink-0">
          {/* Startup Checkbox Toggle */}
          <div
            onClick={() => setAlwaysOnStartup(!alwaysOnStartup)}
            className="flex items-center gap-2 cursor-pointer group select-none min-w-0"
          >
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                alwaysOnStartup
                  ? 'bg-[#171717] border-[#171717] text-white'
                  : 'bg-white border-[#d4d4d4] group-hover:border-neutral-400'
              }`}
            >
              {alwaysOnStartup && <Check className="w-2.5 h-2.5 stroke-[2.5]" />}
            </div>
            <span className="text-xs font-medium text-[#171717] leading-tight select-none">
              Always turn on Speed Limiter on startup
            </span>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {hasActiveLimit && (
              <button
                type="button"
                onClick={() => {
                  onApply(
                    {
                      speedLimit: 0,
                      unit,
                      alwaysOnStartup,
                      enabled: false,
                    },
                    true
                  );
                  onClose();
                }}
                className="bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg px-3.5 h-[38px] text-[13px] font-medium active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                title="Remove speed limit (unlimited)"
              >
                Remove Limit
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="bg-white border border-[#e5e5e5] text-[#525252] hover:text-[#171717] hover:bg-[#f0f0f0] rounded-lg px-4 h-[38px] text-[13px] font-medium active:scale-95 transition-all cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="bg-[#171717] hover:bg-black text-white rounded-lg px-5 h-[38px] text-[13px] font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.4]" />
              <span>OK</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpeedLimiterModal;
