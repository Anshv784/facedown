/** A face-down card whose only marking is a closed eye: a card no one can see. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="3" width="20" height="26" rx="3" fill="#a3262c" stroke="#fbfaf7" strokeWidth="1.8" />
      <path d="M10.5 14.5c2.8 3.4 8.2 3.4 11 0" fill="none" stroke="#fbfaf7" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12.4 17.4l-1.1 1.9M16 18.5v2.2M19.6 17.4l1.1 1.9" stroke="#fbfaf7" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10c4.3 5.4 11.7 5.4 16 0" fill="none" stroke="#fbfaf7" strokeWidth="2" strokeLinecap="round" strokeOpacity=".85" />
      <path d="M7.2 14.2l-1.4 2.3M12 15.8v2.7M16.8 14.2l1.4 2.3" stroke="#fbfaf7" strokeWidth="1.8" strokeLinecap="round" strokeOpacity=".85" />
    </svg>
  );
}
