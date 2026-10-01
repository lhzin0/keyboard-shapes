import type { SVGProps } from 'react';

const PATHS = {
  search: 'M11 4a7 7 0 1 0 4.4 12.4l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  home: 'M12 3 3 10.5V21h6v-6h6v6h6V10.5L12 3Z',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
  build: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.2-.5-.5-2.2 2.2-2.8Z',
  import: 'M12 3v10.2l3.6-3.6L17 11l-6 6-6-6 1.4-1.4L11 13.2V3h1ZM4 19h16v2H4z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v3h-2zM11 20h2v3h-2zM1 11h3v2H1zM20 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  ruler: 'M3 8h18v8H3V8Zm3 0v4h2V8H6Zm4 0v3h2V8h-2Zm4 0v4h2V8h-2Zm4 0v3h2V8h-2Z',
  cube: 'M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3 6.2 3.4L12 11 5.8 7.7 12 4.3ZM5 9.4l6 3.3v6.6l-6-3.3V9.4Zm14 0v6.6l-6 3.3v-6.6l6-3.3Z',
  grid: 'M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z',
  fit: 'M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z',
  reset: 'M12 5a7 7 0 1 1-6.7 9H3.2A9 9 0 1 0 6 6.3V3L1 8l5 5V8.5A7 7 0 0 1 12 5Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  minus: 'M5 11h14v2H5z',
  x: 'm6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z',
  check: 'm9.5 16.2-3.7-3.7L4.4 14l5.1 5.1L20 8.6l-1.4-1.4-9.1 9Z',
  alert: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  link: 'M10.6 13.4a3 3 0 0 1 0-4.2l3-3a3 3 0 0 1 4.2 4.2l-1.4 1.4-1.4-1.4 1.4-1.4a1 1 0 0 0-1.4-1.4l-3 3a1 1 0 0 0 0 1.4l-1.4 1.4ZM13.4 10.6a3 3 0 0 1 0 4.2l-3 3a3 3 0 0 1-4.2-4.2l1.4-1.4 1.4 1.4-1.4 1.4a1 1 0 0 0 1.4 1.4l3-3a1 1 0 0 0 0-1.4l1.4-1.4Z',
  chevron: 'm8.6 6 6 6-6 6-1.4-1.4L11.8 12 7.2 7.4 8.6 6Z',
  down: 'M6 8.6 12 14.6l6-6 1.4 1.4-7.4 7.4-7.4-7.4L6 8.6Z',
  sliders: 'M4 6h9V4h2v2h5v2h-5v2h-2V8H4V6Zm0 10h5v-2h2v2h9v2H11v2H9v-2H4v-2Z',
  eye: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  eyeOff: 'm3 4.3 1.4-1.4 16.7 16.7-1.4 1.4-3-3A11.7 11.7 0 0 1 12 19C7 19 2.7 15.9 1 12a12 12 0 0 1 4-4.9L3 4.3ZM12 5c5 0 9.3 3.1 11 7a12 12 0 0 1-2.7 3.9L17.8 13.4A4 4 0 0 0 11 7.6L8.5 5.2A11.6 11.6 0 0 1 12 5Z',
  explode: 'M11 2h2v5h-2V2Zm0 15h2v5h-2v-5ZM4 9h16v2H4V9Zm0 4h16v2H4v-2Z',
  scissors: 'M3 11h18v2h-6l-3 3-3-3H3v-2Zm4-6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 9a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  rotate: 'M12 4V1L7 5.5 12 10V7a5 5 0 0 1 4.6 7h2.1A7 7 0 0 0 12 4Zm-4.6 6H5.3A7 7 0 0 0 12 20v3l5-4.5L12 14v3a5 5 0 0 1-4.6-7Z',
  target: 'M12 2v3.1A7 7 0 0 0 5.1 11H2v2h3.1A7 7 0 0 0 11 18.9V22h2v-3.1A7 7 0 0 0 18.9 13H22v-2h-3.1A7 7 0 0 0 13 5.1V2h-1Zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v2h-2V7Zm0 4h2v6h-2v-6Z',
  layers: 'm12 2 10 5-10 5L2 7l10-5Zm0 12 7.7-3.8L22 12l-10 5-10-5 2.3-1.8L12 14Zm0 5 7.7-3.8L22 17l-10 5-10-5 2.3-1.8L12 19Z',
  warning: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  upload: 'M11 16V6.8L7.4 10.4 6 9l6-6 6 6-1.4 1.4L13 6.8V16h-2ZM4 19h16v2H4v-2Z',
  trash: 'M9 3h6l1 2h5v2H3V5h5l1-2Zm-3 6h12l-1 12H7L6 9Z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-1.8L6.2 7.8 12 10.4l5.8-2.6L12 5.2Z',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} fillRule="evenodd" />
    </svg>
  );
}
