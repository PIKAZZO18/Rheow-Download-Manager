import React, { useState, useEffect, useRef } from 'react';
import {
  Globe,
  Minus,
  Square,
  X,
  Link2,
  Check,
  User,
  KeyRound,
  ClipboardPaste,
  Eye,
  EyeOff,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface AddUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (params: { url: string; username?: string; password?: string }) => void;
}

export const AddUrlModal: React.FC<AddUrlModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso');
  const [useAuth, setUseAuth] = useState(false);
  const [username, setUsername] = useState('rheow_premium_user');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pastedFeedback, setPastedFeedback] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input and check clipboard when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrlError(null);
      setPastedFeedback(false);
      setShowPassword(false);

      // Auto-focus input
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);

      // Try auto-reading clipboard if it's a valid download link
      (async () => {
        try {
          const nativeText = await invoke<string>('read_clipboard_text');
          if (
            nativeText &&
            (nativeText.startsWith('http://') ||
              nativeText.startsWith('https://') ||
              nativeText.startsWith('ftp://'))
          ) {
            setUrl(nativeText.trim());
            return;
          }
        } catch {}

        try {
          if (navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            if (
              text &&
              (text.startsWith('http://') ||
                text.startsWith('https://') ||
                text.startsWith('ftp://'))
            ) {
              setUrl(text.trim());
            }
          }
        } catch {}
      })();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePasteClipboard = async () => {
    let pastedText = '';

    // 1. Try native OS clipboard via Tauri Rust command
    try {
      const nativeText = await invoke<string>('read_clipboard_text');
      if (nativeText && nativeText.trim()) {
        pastedText = nativeText.trim();
      }
    } catch {}

    // 2. Fallback to browser clipboard API
    if (!pastedText && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          pastedText = text.trim();
        }
      } catch {}
    }

    if (pastedText) {
      setUrl(pastedText);
      setUrlError(null);
      setPastedFeedback(true);
      setTimeout(() => setPastedFeedback(false), 1500);
    } else {
      setUrlError('Clipboard is empty or does not contain text');
    }
  };

  const handleConfirm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError('Please enter a download URL');
      return;
    }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('ftp://')) {
      setUrlError('URL must start with http://, https://, or ftp://');
      return;
    }

    onSubmit({
      url: trimmed,
      username: useAuth && username.trim() ? username.trim() : undefined,
      password: useAuth && password ? password : undefined,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 select-none animate-in fade-in duration-200"
    >
      {/* Click outside backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog Window matching Pencil Node B6trU (Rheow - Add URL) */}
      <div className="relative w-full max-w-[600px] bg-white border border-[#e5e5e5] rounded-[16px] shadow-[0_16px_32px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col z-10 animate-in zoom-in-95 duration-150">
        {/* Window Title Bar (ref: wsNvx, height: 48px, bg: $color-paper) */}
        <div className="h-12 bg-[#f5f5f5] border-b border-[#e5e5e5] px-[18px] flex items-center justify-between shrink-0">
          {/* Title Bar Left */}
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[6px] bg-[#171717] flex items-center justify-center text-white shrink-0 shadow-2xs">
              <Globe className="w-3.5 h-3.5 stroke-[2.2]" />
            </div>
            <span className="text-[13px] font-semibold text-[#171717] tracking-tight">
              Enter new address to download
            </span>
          </div>

          {/* Window Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              title="Minimize"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] hover:bg-[#e5e5e5] active:scale-95 transition-colors cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <div className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] opacity-35">
              <Square className="w-3 h-3" />
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#525252] hover:text-[#171717] hover:bg-[#e5e5e5] active:scale-95 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5 stroke-[2]" />
            </button>
          </div>
        </div>

        {/* Form Container */}
        <form onSubmit={handleConfirm} className="flex flex-col">
          {/* Dialog Content Body (node: Vem3e, padding: 20px 24px, gap: 18px) */}
          <div className="p-5 sm:p-6 bg-white flex flex-col gap-4.5">
            {/* Address Group (node: taJ9M) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="add-url-input"
                  className="text-[11px] font-semibold text-[#525252] tracking-[0.5px] uppercase"
                >
                  ADDRESS
                </label>
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className={`text-[11px] flex items-center gap-1 font-medium cursor-pointer transition-colors ${
                    pastedFeedback
                      ? 'text-[#16a34a] font-semibold'
                      : 'text-[#2563eb] hover:text-[#1d4ed8] hover:underline'
                  }`}
                >
                  {pastedFeedback ? (
                    <>
                      <Check className="w-3 h-3 stroke-[2.5]" />
                      <span>Pasted!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardPaste className="w-3 h-3" />
                      <span>Paste from clipboard</span>
                    </>
                  )}
                </button>
              </div>

              {/* URL Input Row (node: uS3id & ref: bvKfA) */}
              <div
                className={`h-10 px-3 bg-white border rounded-lg flex items-center gap-2.5 transition-all shadow-2xs ${
                  urlError
                    ? 'border-red-400 ring-1 ring-red-400/20'
                    : 'border-[#e5e5e5] focus-within:border-[#2563eb] focus-within:ring-2 focus-within:ring-[#2563eb]/10'
                }`}
              >
                <Link2 className="w-4 h-4 text-[#2563eb] shrink-0 stroke-[2.2]" />
                <input
                  id="add-url-input"
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  placeholder="https://example.com/file.iso"
                  className="w-full bg-transparent outline-hidden text-xs sm:text-[13px] text-[#171717] font-mono placeholder:font-sans placeholder:text-[#a3a3a3]"
                />
              </div>
              {urlError && (
                <span className="text-[11px] text-red-500 font-medium">
                  {urlError}
                </span>
              )}
            </div>

            {/* Authorization Card (node: Fwlaz, fill: $color-paper, cornerRadius: 12) */}
            <div className="bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl p-4 flex flex-col gap-3.5 transition-colors">
              {/* Auth Checkbox Header (node: RetPX) */}
              <div
                onClick={() => setUseAuth(!useAuth)}
                className="flex items-center gap-2.5 cursor-pointer select-none group w-fit"
              >
                <div
                  className={`w-[18px] h-[18px] rounded-[4px] flex items-center justify-center transition-all ${
                    useAuth
                      ? 'bg-[#2563eb] text-white shadow-2xs'
                      : 'bg-white border border-[#d4d4d4] group-hover:border-neutral-400'
                  }`}
                >
                  {useAuth && <Check className="w-3 h-3 stroke-[2.8]" />}
                </div>
                <span className="text-[13px] font-semibold text-[#171717]">
                  Use authentication
                </span>
              </div>

              {/* Credentials Row (node: CIbF1, 2 columns: USERNAME & PASSWORD) */}
              <div
                className={`grid grid-cols-1 sm:grid-cols-2 gap-3 transition-opacity duration-200 ${
                  useAuth ? 'opacity-100' : 'opacity-40 pointer-events-none'
                }`}
              >
                {/* Login Column (node: v587Fj) */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="auth-username"
                    className="text-[10px] font-semibold text-[#525252] tracking-[0.5px] uppercase"
                  >
                    USERNAME
                  </label>
                  <div className="h-9 px-2.5 bg-white border border-[#e5e5e5] focus-within:border-[#2563eb] rounded-lg flex items-center gap-2 shadow-2xs transition-colors">
                    <User className="w-3.5 h-3.5 text-[#737373] shrink-0 stroke-[2]" />
                    <input
                      id="auth-username"
                      type="text"
                      disabled={!useAuth}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username"
                      className="w-full bg-transparent outline-hidden text-xs text-[#171717] font-mono placeholder:font-sans placeholder:text-[#a3a3a3] [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                    />
                  </div>
                </div>

                {/* Password Column with Hide/Unhide Toggle (node: bCQZY) */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="auth-password"
                    className="text-[10px] font-semibold text-[#525252] tracking-[0.5px] uppercase"
                  >
                    PASSWORD
                  </label>
                  <div className="h-9 px-2.5 bg-white border border-[#e5e5e5] focus-within:border-[#2563eb] rounded-lg flex items-center gap-2 shadow-2xs transition-colors">
                    <KeyRound className="w-3.5 h-3.5 text-[#737373] shrink-0 stroke-[2]" />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      disabled={!useAuth}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full bg-transparent outline-hidden text-xs text-[#171717] font-mono placeholder:font-sans placeholder:text-[#a3a3a3] [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                    />
                    {useAuth && (
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? 'Hide password' : 'Show password'}
                        className="text-[#737373] hover:text-[#171717] p-1 rounded-sm cursor-pointer active:scale-90 transition-all shrink-0"
                      >
                        {showPassword ? (
                          <EyeOff className="w-3.5 h-3.5 stroke-[2]" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 stroke-[2]" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dialog Footer Bar (node: gs32X, height: 58px, bg: $color-paper) */}
          <div className="h-[58px] bg-[#f5f5f5] border-t border-[#e5e5e5] px-5 sm:px-6 flex items-center justify-end gap-2.5 shrink-0">
            {/* Cancel Button Instance (ref: bZKn0) */}
            <button
              type="button"
              onClick={onClose}
              className="bg-white border border-[#e5e5e5] hover:bg-[#eaeaea] text-[#171717] rounded-lg px-4 py-2 text-xs font-medium active:scale-95 transition-all cursor-pointer shadow-2xs"
            >
              Cancel
            </button>

            {/* OK Button Instance (ref: zqO2v) */}
            <button
              type="submit"
              className="bg-[#171717] hover:bg-black text-white rounded-lg px-5 py-2 text-xs font-medium active:scale-95 transition-all cursor-pointer shadow-xs min-w-[64px] text-center"
            >
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
