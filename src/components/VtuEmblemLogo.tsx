import React from 'react';

interface VtuEmblemLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<VtuEmblemLogoProps['size']>, string> = {
  sm: 'w-9 h-9 rounded p-0.5 border border-[#E3D2B4]',
  md: 'w-20 h-24 rounded p-1 border border-[#E3D2B4]',
  lg: 'w-24 h-28 rounded p-1.5 border border-[#DF6A24]',
  hero: 'w-52 sm:w-64 h-auto rounded-md p-2 border border-[#E3D2B4]',
};

export const VTU_LOGO_SRC = '/assets/aistudio/images_efb1589f.jpeg';

export const VtuEmblemLogo: React.FC<VtuEmblemLogoProps> = ({
  size = 'md',
  className = '',
}) => {
  return (
    <div
      className={`inline-flex items-center justify-center bg-[#FFFDF8] overflow-hidden shrink-0 select-none ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src={VTU_LOGO_SRC}
        alt="Visvesvaraya Technological University emblem"
        referrerPolicy="no-referrer"
        className="w-full h-full object-contain"
      />
    </div>
  );
};
