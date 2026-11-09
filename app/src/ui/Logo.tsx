/**
 * The Facedown mark: a spade whose heart is a keyhole. The game, locked.
 * Your two cards are sealed to a key only your browser holds; the keyhole's
 * slot runs into the spade's own stem, so the lock is the card's shape, not
 * something added on top.
 */
const SPADE =
  "M32 8.5C26.2 17 13 23.4 13 33.4c0 6.2 4.6 10.3 9.9 10.3 3 0 5.6-1.3 7.2-3.4L27.9 53.5h8.2l-2.2-13.2c1.6 2.1 4.2 3.4 7.2 3.4 5.3 0 9.9-4.1 9.9-10.3C51 23.4 37.8 17 32 8.5z";
const HOLE = "M32 22.7a4.7 4.7 0 0 1 2.1 8.9l1.9 7.1h-8l1.9-7.1A4.7 4.7 0 0 1 32 22.7z";

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#a3262c" />
      <path d={SPADE} fill="#fbfaf7" />
      <path d={HOLE} fill="#a3262c" />
    </svg>
  );
}

/** The same mark, drawn on every card back. */
export function EyeGlyph() {
  return (
    <svg viewBox="8 6 48 50" aria-hidden="true">
      <path d={SPADE} fill="#fbfaf7" fillOpacity=".9" />
      <path d={HOLE} fill="#8f1d22" />
    </svg>
  );
}
