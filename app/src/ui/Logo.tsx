/** A face-down card whose only marking is a closed eye: a card no one can see. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="9" y="4" width="18" height="25" rx="2" fill="#0d0d0c" />
      <rect x="6" y="2.5" width="18" height="25" rx="2" fill="#e1251b" stroke="#0d0d0c" strokeWidth="1.6" />
      <path d="M9.6 14c2.6 3.3 8.2 3.3 10.8 0" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M11.4 17l-1.1 1.9M15 18.1v2.2M18.6 17l1.1 1.9" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10c4.3 5.4 11.7 5.4 16 0" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7.2 14.2l-1.4 2.3M12 15.8v2.7M16.8 14.2l1.4 2.3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
