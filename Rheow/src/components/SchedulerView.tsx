import React, { useState, useEffect, useRef } from 'react';
import {
  Clock,
  Power,
  Layers,
  Play,
  Pause,
  Check,
  Plus,
  Trash2,
  FolderOpen,
  AlertCircle,
  FileText,
  Moon,
  LogOut,
  ListOrdered,
} from 'lucide-react';
import type { DownloadItem } from '../types/download';
import type { SchedulerSettings, QueueDetails, SchedulerActionOnFinish } from '../types/settings';
import { formatBytes } from '../utils/format';
import { TimePicker } from './TimePicker';

interface SchedulerViewProps {
  settings: SchedulerSettings;
  queueDetails: QueueDetails;
  queuedDownloads: DownloadItem[];
  onSaveSettings: (updated: SchedulerSettings, isMasterToggle?: boolean) => Promise<void>;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onResumeDownload: (id: string) => void;
  onCancelDownload: (id: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenAddModal: () => void;
}

const WEEKDAYS = [
  { id: 1, label: 'Mon', full: 'Monday' },
  { id: 2, label: 'Tue', full: 'Tuesday' },
  { id: 3, label: 'Wed', full: 'Wednesday' },
  { id: 4, label: 'Thu', full: 'Thursday' },
  { id: 5, label: 'Fri', full: 'Friday' },
  { id: 6, label: 'Sat', full: 'Saturday' },
  { id: 7, label: 'Sun', full: 'Sunday' },
];

export const SchedulerView: React.FC<SchedulerViewProps> = ({
  settings,
  queueDetails,
  queuedDownloads,
  onSaveSettings,
  onStartQueue,
  onPauseQueue,
  onResumeDownload,
  onCancelDownload,
  onOpenFolder,
  onOpenAddModal,
}) => {
  const [formState, setFormState] = useState<SchedulerSettings>(settings);
  const [enableStopTime, setEnableStopTime] = useState<boolean>(!!settings.stopTime);
  const [isSaving, setIsSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedTimerRef = useRef<number | null>(null);

  // Sync when prop changes
  useEffect(() => {
    setFormState(settings);
    setEnableStopTime(!!settings.stopTime);
  }, [settings]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    };
  }, []);

  const persist = async (nextSettings: SchedulerSettings, isMasterToggle = false) => {
    setIsSaving(true);
    try {
      await onSaveSettings(nextSettings, isMasterToggle);
      setSavedFeedback(true);
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSavedFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to auto-save scheduler settings:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleEnabled = (enabled: boolean) => {
    const updated = {
      ...formState,
      enabled,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, true);
  };

  const handleSetDays = (days: number[]) => {
    const updated = {
      ...formState,
      days,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const toggleDay = (dayId: number) => {
    const currentDays = formState.days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : formState.days;
    const exists = currentDays.includes(dayId);
    let newDays = exists ? currentDays.filter((d) => d !== dayId) : [...currentDays, dayId];
    newDays.sort((a, b) => a - b);
    if (newDays.length === 7) {
      newDays = [];
    }
    const updated = {
      ...formState,
      days: newDays,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const handleSetStartTime = (startTime: string) => {
    const updated = {
      ...formState,
      startTime,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const handleToggleStopTime = (enabled: boolean) => {
    setEnableStopTime(enabled);
    const updated = {
      ...formState,
      stopTime: enabled && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const handleSetStopTime = (stopTime: string) => {
    const updated = {
      ...formState,
      stopTime: enableStopTime ? stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const handleSetConcurrency = (maxConcurrentQueue: number) => {
    const updated = {
      ...formState,
      maxConcurrentQueue,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const handleSetActionOnFinish = (actionOnFinish: SchedulerActionOnFinish) => {
    const updated = {
      ...formState,
      actionOnFinish,
      stopTime: enableStopTime && formState.stopTime ? formState.stopTime : null,
    };
    setFormState(updated);
    persist(updated, false);
  };

  const isDayActive = (dayId: number) => {
    return formState.days.length === 0 || formState.days.includes(dayId);
  };

  const isAll = formState.days.length === 0 || formState.days.length === 7;
  const isWeekdays =
    formState.days.length === 5 && [1, 2, 3, 4, 5].every((d) => formState.days.includes(d));
  const isWeekends =
    formState.days.length === 2 && [6, 7].every((d) => formState.days.includes(d));

  return (
    <div className="flex-1 flex flex-col gap-3.5 overflow-y-auto pr-1 select-none">
      {/* Top Banner / Master Switch */}
      <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-xl px-4 py-3 sm:px-5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              formState.enabled
                ? 'bg-[#16a34a] text-white shadow-xs'
                : 'bg-[#e5e5e5] text-[#737373]'
            }`}
          >
            <Clock className="w-4.5 h-4.5 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-[#171717] tracking-tight">
                Download Scheduler
              </h2>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                  formState.enabled
                    ? 'bg-[#dcfce7] text-[#15803d] border-[#86efac]'
                    : 'bg-[#f5f5f5] text-[#737373] border-[#e5e5e5]'
                }`}
              >
                {formState.enabled ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
            <p className="text-[11px] text-[#737373] mt-0.5 truncate">
              {formState.enabled
                ? `Runs queue automatically at ${formState.startTime}${
                    enableStopTime && formState.stopTime ? ` – ${formState.stopTime}` : ''
                  } on ${isAll ? 'all days' : isWeekdays ? 'weekdays' : isWeekends ? 'weekends' : `${formState.days.length} selected days`}`
                : 'Automate queue execution at scheduled hours and days of the week'}
            </p>
          </div>
        </div>

        {/* Master Switch & Auto-save Status */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {isSaving && (
            <span className="text-[11px] font-medium text-[#737373] animate-pulse">
              Saving…
            </span>
          )}
          {!isSaving && savedFeedback && (
            <span className="text-[11px] font-medium text-[#16a34a] flex items-center gap-1 transition-opacity">
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              Saved
            </span>
          )}

          <label className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-[#e5e5e5] bg-white hover:bg-[#f5f5f5] transition-colors cursor-pointer select-none shadow-2xs">
            <span className="text-xs font-semibold text-[#171717]">
              {formState.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <input
              type="checkbox"
              checked={formState.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-[#d4d4d4] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#16a34a] relative"></div>
          </label>
        </div>
      </div>

      {/* Grid: 2 Balanced Configuration Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Card 1: Schedule Window & Days */}
        <div className="bg-white border border-[#e5e5e5] rounded-xl p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#171717]">
                <Clock className="w-4 h-4 text-[#2563eb]" />
                <span>Execution Schedule</span>
              </div>
              <div className="flex items-center gap-1 bg-[#f5f5f5] p-0.5 rounded-md border border-[#e5e5e5]">
                <button
                  type="button"
                  onClick={() => handleSetDays([])}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                    isAll ? 'bg-white text-[#171717] shadow-2xs' : 'text-[#737373] hover:text-[#171717]'
                  }`}
                >
                  Everyday
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDays([1, 2, 3, 4, 5])}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                    isWeekdays ? 'bg-white text-[#171717] shadow-2xs' : 'text-[#737373] hover:text-[#171717]'
                  }`}
                >
                  Weekdays
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDays([6, 7])}
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors cursor-pointer ${
                    isWeekends ? 'bg-white text-[#171717] shadow-2xs' : 'text-[#737373] hover:text-[#171717]'
                  }`}
                >
                  Weekends
                </button>
              </div>
            </div>

            {/* Time Window Inputs */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-2.5">
                <span className="block text-[11px] font-medium text-[#737373] mb-1.5">
                  Start Queue At
                </span>
                <TimePicker
                  value={formState.startTime}
                  onChange={(val) => handleSetStartTime(val)}
                  align="left"
                />
              </div>

              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-[#737373]">Stop Queue At</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableStopTime}
                      onChange={(e) => handleToggleStopTime(e.target.checked)}
                      className="w-3.5 h-3.5 text-[#2563eb] rounded border-[#d4d4d4] accent-[#2563eb]"
                    />
                    <span className="text-[10px] font-medium text-[#525252]">Enable</span>
                  </label>
                </div>
                <TimePicker
                  value={formState.stopTime || '06:00'}
                  disabled={!enableStopTime}
                  onChange={(val) => handleSetStopTime(val)}
                  align="right"
                />
              </div>
            </div>

            {/* Weekday Pills */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-[#737373]">Active Days</span>
                <span className="text-[10px] text-[#737373]">
                  {isAll ? 'All 7 days' : `${formState.days.length} days selected`}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((day) => {
                  const active = isDayActive(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleDay(day.id)}
                      title={day.full}
                      className={`h-8 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center ${
                        active
                          ? 'bg-[#2563eb] text-white shadow-2xs'
                          : 'bg-[#fafafa] border border-[#e5e5e5] text-[#737373] hover:text-[#171717] hover:bg-[#f0f0f0]'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Queue & Completion Settings */}
        <div className="bg-white border border-[#e5e5e5] rounded-xl p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#171717]">
                <Layers className="w-4 h-4 text-[#16a34a]" />
                <span>Queue & Completion</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    queueDetails.isRunning ? 'bg-[#16a34a] animate-pulse' : 'bg-[#a3a3a3]'
                  }`}
                />
                <span className="text-[10px] font-semibold text-[#737373]">
                  {queueDetails.isRunning ? 'Queue Active' : 'Queue Idle'}
                </span>
              </div>
            </div>

            {/* Concurrency and Queue Control */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg px-3 py-2 flex items-center justify-between min-h-[46px]">
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold text-[#171717]">Concurrency</span>
                  <span className="text-[10px] text-[#737373]">Max simultaneous</span>
                </div>
                <div className="flex items-center border border-[#d4d4d4] rounded-md overflow-hidden bg-white shadow-2xs">
                  <button
                    type="button"
                    onClick={() =>
                      handleSetConcurrency(Math.max(1, formState.maxConcurrentQueue - 1))
                    }
                    className="w-7 h-7 flex items-center justify-center text-xs hover:bg-[#f5f5f5] text-[#171717] font-bold cursor-pointer transition-colors"
                  >
                    -
                  </button>
                  <span className="w-8 h-7 flex items-center justify-center text-xs font-bold text-[#171717] bg-[#fafafa] border-x border-[#e5e5e5]">
                    {formState.maxConcurrentQueue}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleSetConcurrency(Math.min(10, formState.maxConcurrentQueue + 1))
                    }
                    className="w-7 h-7 flex items-center justify-center text-xs hover:bg-[#f5f5f5] text-[#171717] font-bold cursor-pointer transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {queueDetails.isRunning ? (
                <button
                  type="button"
                  onClick={onPauseQueue}
                  className="w-full h-full min-h-[46px] px-3.5 rounded-lg bg-[#ea580c] hover:bg-[#c2410c] border border-[#c2410c]/40 text-white text-[13px] sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs hover:shadow-sm active:scale-[0.98]"
                >
                  <Pause className="w-4 h-4 fill-white text-white shrink-0" />
                  <span>Pause Queue</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartQueue}
                  className="w-full h-full min-h-[46px] px-3.5 rounded-lg bg-[#16a34a] hover:bg-[#15803d] border border-[#15803d]/40 text-white text-[13px] sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs hover:shadow-sm active:scale-[0.98]"
                >
                  <Play className="w-4 h-4 fill-white text-white shrink-0" />
                  <span>Start Queue Now</span>
                </button>
              )}
            </div>

            {/* Post-Completion Action Pills */}
            <div className="mt-3">
              <div className="mb-1.5">
                <span className="text-[11px] font-medium text-[#737373]">Post-Completion Action</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'none', label: 'Do Nothing', icon: AlertCircle },
                  { id: 'shutdown', label: 'Shutdown PC', icon: Power },
                  { id: 'sleep', label: 'Sleep PC', icon: Moon },
                  { id: 'quit', label: 'Quit Rheow', icon: LogOut },
                ].map((act) => {
                  const isSelected = formState.actionOnFinish === act.id;
                  const Icon = act.icon;
                  return (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() =>
                        handleSetActionOnFinish(act.id as SchedulerActionOnFinish)
                      }
                      className={`h-8.5 px-3 rounded-lg border text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                        isSelected
                          ? 'bg-[#171717] border-[#171717] text-white shadow-2xs'
                          : 'bg-[#fafafa] border-[#e5e5e5] text-[#525252] hover:bg-[#f0f0f0] hover:text-[#171717]'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-[#737373]'}`} />
                      <span>{act.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Queued Downloads Section */}
      <div className="bg-white border border-[#e5e5e5] rounded-xl p-4 flex flex-col gap-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-[#7c3aed]" />
            <h3 className="text-xs font-bold text-[#171717] tracking-tight">
              Queued Downloads ({queuedDownloads.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="h-7 px-2.5 rounded-lg bg-[#fafafa] border border-[#e5e5e5] hover:bg-[#f0f0f0] text-[#171717] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Download</span>
          </button>
        </div>

        {queuedDownloads.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-[#e5e5e5] rounded-lg bg-[#fafafa]">
            <ListOrdered className="w-8 h-8 text-[#a3a3a3] mx-auto mb-2 opacity-50" />
            <p className="text-xs font-semibold text-[#525252]">No downloads waiting in queue</p>
            <p className="text-[11px] text-[#737373] mt-0.5 max-w-sm mx-auto">
              Click &quot;Download Later&quot; when adding a download from your browser or URL to queue files for scheduled execution.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f0] border border-[#e5e5e5] rounded-lg overflow-hidden">
            {queuedDownloads.map((item, index) => (
              <div
                key={item.id}
                className="p-3 bg-white hover:bg-[#fafafa] flex items-center justify-between gap-3 transition-colors text-xs"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="text-[11px] font-bold text-[#a3a3a3] w-4 shrink-0 text-center">
                    {index + 1}
                  </span>
                  <div className="w-7 h-7 rounded-lg bg-[#f5f5f5] border border-[#e5e5e5] flex items-center justify-center shrink-0">
                    <FileText className="w-3.5 h-3.5 text-[#525252]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-[#171717] truncate block" title={item.fileName}>
                      {item.fileName}
                    </span>
                    <div className="flex items-center gap-2 text-[10px] text-[#737373] mt-0.5">
                      <span>{formatBytes(item.totalSize)}</span>
                      <span>•</span>
                      <span className="px-1.5 py-0.2 bg-[#f0f0f0] rounded text-[9px] font-medium text-[#525252]">
                        {item.category}
                      </span>
                      <span>•</span>
                      <span className="truncate max-w-[200px]" title={item.destinationPath}>
                        {item.destinationPath}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Individual Item Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onResumeDownload(item.id)}
                    className="p-1.5 rounded-md hover:bg-[#dcfce7] text-[#15803d] transition-colors cursor-pointer"
                    title="Start this download immediately"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenFolder(item.destinationPath)}
                    className="p-1.5 rounded-md hover:bg-[#f0f0f0] text-[#525252] transition-colors cursor-pointer"
                    title="Open destination folder"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancelDownload(item.id)}
                    className="p-1.5 rounded-md hover:bg-[#fee2e2] text-[#dc2626] transition-colors cursor-pointer"
                    title="Remove from queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
