import type { SVGProps } from 'react';

/** Schlichte Linien-Icons im Stil der SF Symbols (24×24, Strichstärke 1.8, currentColor). */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconToday = (p: IconProps) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8.5 14.5l2.2 2.2 4.8-4.7" /></Svg>
);
export const IconNexus = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9.5" r="2.5" /><path d="M16.5 14.6c2.4.2 4 1.7 4.5 4.4" /></Svg>
);
export const IconCar = (p: IconProps) => (
  <Svg {...p}><path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" /><path d="M3.5 12h17v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V12z" /><path d="M6 17.5v1.5M18 17.5v1.5" /><circle cx="7.5" cy="14.5" r=".6" fill="currentColor" /><circle cx="16.5" cy="14.5" r=".6" fill="currentColor" /></Svg>
);
export const IconChat = (p: IconProps) => (
  <Svg {...p}><path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-.9 0-1.8-.1-2.6-.3L5 19.5l1.2-3.4C4.5 14.8 3.5 13 3.5 11c0-3.9 3.8-7 8.5-7z" /></Svg>
);
export const IconAssistant = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.5a8.5 8.5 0 1 1-4.3 15.8L3.5 20.5l1.2-4A8.5 8.5 0 0 1 12 3.5z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.6-2-1-1 .9a3.7 3.7 0 0 1-1.8-1.8l.9-1-1-2-1.6 1z" /></Svg>
);
export const IconLink = (p: IconProps) => (
  <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>
);
export const IconLog = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>
);
export const IconGear = (p: IconProps) => (
  <Svg {...p} strokeWidth={1.6}><path d="M12.00 4.80 L13.81 2.88 L15.56 3.41 L16.00 6.01 L17.09 6.91 L19.73 6.83 L20.59 8.44 L19.06 10.60 L19.20 12.00 L21.12 13.81 L20.59 15.56 L17.99 16.00 L17.09 17.09 L17.17 19.73 L15.56 20.59 L13.40 19.06 L12.00 19.20 L10.19 21.12 L8.44 20.59 L8.00 17.99 L6.91 17.09 L4.27 17.17 L3.41 15.56 L4.94 13.40 L4.80 12.00 L2.88 10.19 L3.41 8.44 L6.01 8.00 L6.91 6.91 L6.83 4.27 L8.44 3.41 L10.60 4.94z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconChevron = (p: IconProps) => (
  <Svg size={14} strokeWidth={2.4} {...p}><path d="M9 5l7 7-7 7" /></Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg size={14} strokeWidth={3} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);
export const IconWarning = (p: IconProps) => (
  <Svg size={18} {...p}><path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.5 13a2 2 0 0 1-1.7 3H4.5a2 2 0 0 1-1.7-3z" /><path d="M12 9.5v4" /><circle cx="12" cy="16.8" r=".4" fill="currentColor" /></Svg>
);
export const IconMore = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="8" cy="12" r=".5" fill="currentColor" /><circle cx="12" cy="12" r=".5" fill="currentColor" /><circle cx="16" cy="12" r=".5" fill="currentColor" /></Svg>
);
