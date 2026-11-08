/** A face-down card whose only marking is a closed eye: a card no one can see. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g transform="rotate(-8 16 16)">
        <rect x="7" y="3.5" width="18" height="25" rx="3" fill="#3a1a17" stroke="#c19a5b" strokeWidth="1.4" />
        <path d="M11 15.5c2.6 3.2 7.4 3.2 10 0" fill="none" stroke="#e3c48c" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12.6 18.2l-1 1.7M16 19.2v2M19.4 18.2l1 1.7" stroke="#e3c48c" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10c4.5 5.5 13.5 5.5 18 0" fill="none" stroke="#e3c48c" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.5 14l-1.4 2.2M12 15.6v2.6M17.5 14l1.4 2.2" stroke="#e3c48c" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
