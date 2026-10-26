import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, ChevronDown, Check } from 'lucide-react';

interface TimePickerProps {
  value: string; // "HH:MM" (24-hour format)
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  align?: 'left' | 'right';
}

const PRESET_TIMES = [
  { label: '00:00', hint: 'Midnight' },
  { label: '02:00', hint: 'Night' },
  { label: '04:00', hint: 'Dawn' },
  { label: '06:00', hint: 'Morning' },
  { label: '12:00', hint: 'Noon' },
  { label: '18:00', hint: 'Evening' },
  { label: '23:00', hint: 'Late' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));

export const TimePicker: React.FC<TimePickerProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
  id,
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);
  const activeAnimations = useRef<{ hour?: number; minute?: number }>({});

  // Normalize hours & minutes
  const [rawH = '00', rawM = '00'] = (value || '00:00').split(':');
  const hNum = Math.min(23, Math.max(0, parseInt(rawH, 10) || 0));
  const mNum = Math.min(59, Math.max(0, parseInt(rawM, 10) || 0));
  const currentHour = hNum.toString().padStart(2, '0');
  const currentMinute = mNum.toString().padStart(2, '0');

  // Local input values for typing
  const [hourInput, setHourInput] = useState(currentHour);
  const [minuteInput, setMinuteInput] = useState(currentMinute);

  useEffect(() => {
    setHourInput(currentHour);
    setMinuteInput(currentMinute);
  }, [currentHour, currentMinute]);

  // Clean up any running animation frame on unmount
  useEffect(() => {
    return () => {
      if (activeAnimations.current.hour) cancelAnimationFrame(activeAnimations.current.hour);
      if (activeAnimations.current.minute) cancelAnimationFrame(activeAnimations.current.minute);
    };
  }, []);

  // Handle outside click & escape to close
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Calculate target scroll position to center the item
  const getTargetScroll = (container: HTMLElement, targetIndex: number): number => {
    const itemHeight = 26; // 24px button + 2px space gap
    const containerHeight = container.clientHeight || 144;
    const itemTop = targetIndex * itemHeight;
    const target = itemTop - containerHeight / 2 + itemHeight / 2;
    const maxScroll = Math.max(0, container.scrollHeight - containerHeight);
    return Math.max(0, Math.min(maxScroll, target));
  };

  // Determine starting position to guarantee a visible, kinetic roll
  const getEntranceStartScroll = (targetScroll: number, maxScroll: number): number => {
    if (targetScroll < 60) {
      // Near top: start from further down so it rolls up to target
      return Math.min(maxScroll, targetScroll + 120);
    }
    // Further down: start from higher up so it rolls down to target
    return Math.max(0, targetScroll - 140);
  };

  // Kinetic scroll engine with natural deceleration
  const smoothScroll = useCallback(
    (container: HTMLElement, startY: number, targetY: number, duration = 400) => {
      const animKey = container === hourListRef.current ? 'hour' : 'minute';
      if (activeAnimations.current[animKey]) {
        cancelAnimationFrame(activeAnimations.current[animKey]!);
      }

      container.scrollTop = startY;
      if (Math.abs(targetY - startY) < 1) {
        container.scrollTop = targetY;
        return;
      }

      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReduced) {
        container.scrollTop = targetY;
        return;
      }

      const startTime = performance.now();
      // Natural exponential deceleration curve (cubic-bezier(0.16, 1, 0.3, 1))
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3.5);

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOut(progress);

        container.scrollTop = startY + (targetY - startY) * eased;

        if (progress < 1) {
          activeAnimations.current[animKey] = requestAnimationFrame(step);
        } else {
          container.scrollTop = targetY;
          delete activeAnimations.current[animKey];
        }
      };

      activeAnimations.current[animKey] = requestAnimationFrame(step);
    },
    []
  );

  // Trigger rolling tumbler animation upon opening the popover
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      const hContainer = hourListRef.current;
      const mContainer = minuteListRef.current;

      if (hContainer) {
        const targetY = getTargetScroll(hContainer, hNum);
        const startY = getEntranceStartScroll(
          targetY,
          hContainer.scrollHeight - hContainer.clientHeight
        );
        smoothScroll(hContainer, startY, targetY, 440);
      }

      if (mContainer) {
        const targetY = getTargetScroll(mContainer, mNum);
        const startY = getEntranceStartScroll(
          targetY,
          mContainer.scrollHeight - mContainer.clientHeight
        );
        // Stagger minute roll by 35ms for an authentic dual-reel mechanical feel
        const mTimer = setTimeout(() => {
          if (mContainer) {
            smoothScroll(mContainer, startY, targetY, 460);
          }
        }, 35);

        return () => clearTimeout(mTimer);
      }
    }, 25);

    return () => clearTimeout(timer);
  }, [isOpen, hNum, mNum, smoothScroll]);

  const updateTime = (newH: string, newM: string) => {
    const formatted = `${newH.padStart(2, '0')}:${newM.padStart(2, '0')}`;
    onChange(formatted);
  };

  const handleSelectHour = (h: string) => {
    updateTime(h, currentMinute);
    const targetHNum = parseInt(h, 10) || 0;
    if (hourListRef.current) {
      const targetY = getTargetScroll(hourListRef.current, targetHNum);
      smoothScroll(hourListRef.current, hourListRef.current.scrollTop, targetY, 260);
    }
  };

  const handleSelectMinute = (m: string) => {
    updateTime(currentHour, m);
    const targetMNum = parseInt(m, 10) || 0;
    if (minuteListRef.current) {
      const targetY = getTargetScroll(minuteListRef.current, targetMNum);
      smoothScroll(minuteListRef.current, minuteListRef.current.scrollTop, targetY, 260);
    }
  };

  const handleSelectPreset = (presetTime: string) => {
    onChange(presetTime);
    const [newH = '00', newM = '00'] = presetTime.split(':');
    const targetHNum = parseInt(newH, 10) || 0;
    const targetMNum = parseInt(newM, 10) || 0;

    if (hourListRef.current) {
      const targetY = getTargetScroll(hourListRef.current, targetHNum);
      smoothScroll(hourListRef.current, hourListRef.current.scrollTop, targetY, 340);
    }
    if (minuteListRef.current) {
      const targetY = getTargetScroll(minuteListRef.current, targetMNum);
      smoothScroll(minuteListRef.current, minuteListRef.current.scrollTop, targetY, 360);
    }
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 2);
    setHourInput(val);

    if (val.length === 1 && parseInt(val, 10) >= 3) {
      const formatted = `0${val}`;
      setHourInput(formatted);
      updateTime(formatted, currentMinute);
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
      return;
    }

    if (val.length === 2) {
      const num = Math.min(23, Math.max(0, parseInt(val, 10) || 0));
      const formatted = num.toString().padStart(2, '0');
      setHourInput(formatted);
      updateTime(formatted, currentMinute);
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    }
  };

  const handleHourBlur = () => {
    const num = Math.min(23, Math.max(0, parseInt(hourInput, 10) || 0));
    const formatted = num.toString().padStart(2, '0');
    setHourInput(formatted);
    updateTime(formatted, currentMinute);
  };

  const handleHourKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (hNum + 1) % 24;
      const formatted = next.toString().padStart(2, '0');
      setHourInput(formatted);
      handleSelectHour(formatted);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const prev = (hNum - 1 + 24) % 24;
      const formatted = prev.toString().padStart(2, '0');
      setHourInput(formatted);
      handleSelectHour(formatted);
    } else if (e.key === 'ArrowRight' || e.key === ':') {
      e.preventDefault();
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    } else if (e.key === 'Enter') {
      handleHourBlur();
      setIsOpen(false);
    }
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 2);
    setMinuteInput(val);

    if (val.length === 1 && parseInt(val, 10) >= 6) {
      const formatted = `0${val}`;
      setMinuteInput(formatted);
      updateTime(currentHour, formatted);
      return;
    }

    if (val.length === 2) {
      const num = Math.min(59, Math.max(0, parseInt(val, 10) || 0));
      const formatted = num.toString().padStart(2, '0');
      setMinuteInput(formatted);
      updateTime(currentHour, formatted);
    }
  };

  const handleMinuteBlur = () => {
    const num = Math.min(59, Math.max(0, parseInt(minuteInput, 10) || 0));
    const formatted = num.toString().padStart(2, '0');
    setMinuteInput(formatted);
    updateTime(currentHour, formatted);
  };

  const handleMinuteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (mNum + 1) % 60;
      const formatted = next.toString().padStart(2, '0');
      setMinuteInput(formatted);
      handleSelectMinute(formatted);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const prev = (mNum - 1 + 60) % 60;
      const formatted = prev.toString().padStart(2, '0');
      setMinuteInput(formatted);
      handleSelectMinute(formatted);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      hourInputRef.current?.focus();
      hourInputRef.current?.select();
    } else if (e.key === 'Backspace' && !minuteInput) {
      e.preventDefault();
      hourInputRef.current?.focus();
      hourInputRef.current?.select();
    } else if (e.key === 'Enter') {
      handleMinuteBlur();
      setIsOpen(false);
    }
  };

  const toggleDropdown = (e: React.MouseEvent) => {
    if (disabled) return;
    if (e.target === hourInputRef.current || e.target === minuteInputRef.current) {
      return;
    }
    setIsOpen((prev) => !prev);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} id={id}>
      {/* Trigger Bar */}
      <div
        onClick={toggleDropdown}
        className={`w-full h-8.5 bg-white border rounded-lg px-2.5 flex items-center justify-between text-sm transition-all cursor-pointer ${
          disabled
            ? 'border-[#e5e5e5] bg-[#f5f5f5] opacity-50 cursor-not-allowed'
            : isOpen
            ? 'border-[#2563eb] ring-2 ring-[#2563eb]/15 shadow-2xs'
            : 'border-[#d4d4d4] hover:border-[#a3a3a3]'
        }`}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Clock className={`w-3.5 h-3.5 shrink-0 ${isOpen ? 'text-[#2563eb]' : 'text-[#737373]'}`} />

          {/* Segmented Inputs */}
          <div className="flex items-center font-mono font-semibold text-xs sm:text-sm text-[#171717]">
            <input
              ref={hourInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={hourInput}
              disabled={disabled}
              onChange={handleHourChange}
              onBlur={handleHourBlur}
              onKeyDown={handleHourKeyDown}
              onClick={(e) => {
                e.stopPropagation();
                hourInputRef.current?.select();
              }}
              title="Hour (00-23)"
              className="w-7 text-center bg-transparent outline-none focus:bg-[#f5f5f5] rounded px-0 py-0.5 selection:bg-[#2563eb] selection:text-white disabled:cursor-not-allowed"
            />
            <span className="text-[#a3a3a3] font-bold select-none px-0.5">:</span>
            <input
              ref={minuteInputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={minuteInput}
              disabled={disabled}
              onChange={handleMinuteChange}
              onBlur={handleMinuteBlur}
              onKeyDown={handleMinuteKeyDown}
              onClick={(e) => {
                e.stopPropagation();
                minuteInputRef.current?.select();
              }}
              title="Minute (00-59)"
              className="w-7 text-center bg-transparent outline-none focus:bg-[#f5f5f5] rounded px-0 py-0.5 selection:bg-[#2563eb] selection:text-white disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Dropdown Chevron */}
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) setIsOpen((prev) => !prev);
          }}
          className={`p-1 rounded text-[#737373] hover:text-[#171717] hover:bg-[#f5f5f5] transition-transform ${
            isOpen ? 'rotate-180 text-[#2563eb]' : ''
          } disabled:cursor-not-allowed disabled:hover:bg-transparent`}
          title="Pick time"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sleek Dub-compliant Time Picker Dropdown with Rolling Tumbler Animation */}
      {isOpen && (
        <div
          className={`absolute top-[calc(100%+6px)] z-50 w-64 bg-white border border-[#e5e5e5] rounded-xl shadow-lg p-3 text-[#171717] animate-in fade-in zoom-in-95 slide-in-from-top-1.5 duration-150 ease-out ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* Quick Presets */}
          <div className="mb-2.5">
            <div className="text-[10px] font-semibold text-[#737373] uppercase tracking-wider mb-1.5 px-0.5">
              Quick Presets
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESET_TIMES.map((preset) => {
                const isSelected = `${currentHour}:${currentMinute}` === preset.label;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleSelectPreset(preset.label)}
                    title={preset.hint}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded-md font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#2563eb] text-white shadow-2xs font-semibold'
                        : 'bg-[#f5f5f5] hover:bg-[#e5e5e5] text-[#171717]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[#f0f0f0] my-2" />

          {/* Hour & Minute Rolling Tumbler Columns */}
          <div className="grid grid-cols-2 gap-2">
            {/* Hours Column */}
            <div>
              <div className="text-[10px] font-semibold text-[#737373] uppercase tracking-wider text-center py-1 bg-[#fafafa] rounded-md mb-1 border border-[#f0f0f0]">
                Hour
              </div>
              <div
                ref={hourListRef}
                className="h-36 overflow-y-auto space-y-0.5 pr-0.5 select-none"
              >
                {HOURS.map((h) => {
                  const isSelected = h === currentHour;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleSelectHour(h)}
                      className={`w-full py-1 text-center text-xs font-mono rounded-md transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#2563eb] text-white font-semibold shadow-2xs scale-[1.02]'
                          : 'text-[#171717] hover:bg-[#f5f5f5] active:scale-95'
                      }`}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Minutes Column */}
            <div>
              <div className="text-[10px] font-semibold text-[#737373] uppercase tracking-wider text-center py-1 bg-[#fafafa] rounded-md mb-1 border border-[#f0f0f0]">
                Minute
              </div>
              <div
                ref={minuteListRef}
                className="h-36 overflow-y-auto space-y-0.5 pr-0.5 select-none"
              >
                {MINUTES.map((m) => {
                  const isSelected = m === currentMinute;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSelectMinute(m)}
                      className={`w-full py-1 text-center text-xs font-mono rounded-md transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#2563eb] text-white font-semibold shadow-2xs scale-[1.02]'
                          : 'text-[#171717] hover:bg-[#f5f5f5] active:scale-95'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="border-t border-[#f0f0f0] my-2" />

          {/* Footer Bar */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[11px] text-[#737373]">
              Selected:{' '}
              <strong className="text-[#171717] font-mono font-semibold">
                {currentHour}:{currentMinute}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-2.5 py-1 text-[11px] font-semibold bg-[#171717] hover:bg-black text-white rounded-md shadow-2xs transition-colors cursor-pointer flex items-center gap-1 active:scale-95"
            >
              <Check className="w-3 h-3" />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimePicker;
