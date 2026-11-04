import { useId } from "react";

/**
 * The ExplainCut mark: a speaker in front, a hand-drawn diagram sketched behind.
 * Keep in sync with app/icon.svg and public/logo.svg (same 64×64 drawing).
 */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId();
  const grad = `${id}-g`;
  const clip = `${id}-c`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ed7940" />
          <stop offset="1" stopColor="#c4530f" />
        </linearGradient>
        <clipPath id={clip}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${grad})`} />
      <g clipPath={`url(#${clip})`}>
        <path d="M10.6 11.8c6.2-.9 12.4-.6 18.3.2.6 3.9.5 7.6-.1 11.4-6 .7-12 .5-17.9-.2-.7-3.8-.8-7.6-.3-11.4z" fill="none" stroke="#fbfaf7" strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M32.6 17.6c5.4-1.2 10.6-.4 15.2 2.6" fill="none" stroke="#fbfaf7" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M43.2 15.6l5 4.8-6.4 2.4" fill="none" stroke="#fbfaf7" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="42" cy="38" r="8.6" fill="#1e1a15" />
        <path d="M23 68c0-13 8.4-20.6 19-20.6S61 55 61 68z" fill="#1e1a15" />
      </g>
    </svg>
  );
}
