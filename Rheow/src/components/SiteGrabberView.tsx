import React from 'react';
import { Globe } from 'lucide-react';

export const SiteGrabberView: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center border border-[#e5e5e5] rounded-xl bg-white shadow-2xs select-none p-8">
      <div className="w-14 h-14 rounded-2xl bg-[#fafafa] border border-[#e5e5e5] flex items-center justify-center mb-3 shadow-2xs">
        <Globe className="w-7 h-7 stroke-[1.8] text-[#2563eb]" />
      </div>
      <h3 className="text-sm font-bold text-[#171717] tracking-tight">
        Site Grabber
      </h3>
      <span className="mt-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#f5f5f5] text-[#737373] border border-[#e5e5e5]">
        Under Development
      </span>
    </div>
  );
};
