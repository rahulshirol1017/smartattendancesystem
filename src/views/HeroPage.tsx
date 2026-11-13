import React from 'react';
import { VTU_LOGO_SRC } from '../components/VtuEmblemLogo.tsx';

interface HeroPageProps {
  onNavigateToAuth: () => void;
}

export const HeroPage: React.FC<HeroPageProps> = ({ onNavigateToAuth }) => {
  return (
    <main
      role="button"
      tabIndex={0}
      aria-label="Visvesvaraya Technological University Smart Attendance System — Continue to Sign In"
      onClick={onNavigateToAuth}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigateToAuth();
        }
      }}
      className="min-h-screen w-full bg-[#FAF3E3] flex flex-col items-center justify-center px-6 py-12 cursor-pointer select-none focus:outline-none"
    >
      <div className="flex flex-col items-center text-center gap-6 max-w-3xl">
        <div className="rounded-md border border-[#E3D2B4] bg-[#FFFDF8] p-3">
          <img
            src={VTU_LOGO_SRC}
            alt="Visvesvaraya Technological University Logo"
            referrerPolicy="no-referrer"
            className="w-52 sm:w-64 md:w-72 h-auto object-contain rounded"
          />
        </div>

        <div className="space-y-2">
          <h1
            className="font-display text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[#165B33]"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            Visvesvaraya Technological University
          </h1>
          <p className="font-display text-base sm:text-xl font-semibold text-[#DF6A24]">
            Smart Attendance System
          </p>
        </div>
      </div>
    </main>
  );
};
