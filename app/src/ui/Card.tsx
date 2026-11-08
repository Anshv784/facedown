import { rank, suit, type Card as C } from "../lib/poker";
import { EyeGlyph } from "./Logo";

const RANK = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const PIP = ["♣", "♦", "♥", "♠"];
const NAME = ["clubs", "diamonds", "hearts", "spades"];
const RANK_NAME = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king", "ace"];

export const cardLabel = (c: C) => `${RANK_NAME[rank(c)]} of ${NAME[suit(c)]}`;

export function Card({
  card,
  down,
  win,
  dim,
  fresh,
  style,
}: {
  card?: C | null;
  down?: boolean;
  win?: boolean;
  dim?: boolean;
  fresh?: boolean;
  style?: React.CSSProperties;
}) {
  const known = card !== undefined && card !== null;
  const showBack = down || !known;
  const cls = ["pcard", showBack && "down", win && "win", dim && "dim", fresh && "fresh"].filter(Boolean).join(" ");
  const red = known && (suit(card) === 1 || suit(card) === 2);
  return (
    <div className={cls} style={style} role="img" aria-label={showBack ? "face-down card" : cardLabel(card)}>
      <div className="inner">
        <div className={`face${red ? " red" : ""}`}>
          {known && (
            <>
              <span className="rank">
                {RANK[rank(card)]}
                <span style={{ fontSize: "0.62em", marginLeft: 1 }}>{PIP[suit(card)]}</span>
              </span>
              <span className="pip">{PIP[suit(card)]}</span>
            </>
          )}
        </div>
        <div className="back">
          <EyeGlyph />
        </div>
      </div>
    </div>
  );
}

export function Slot({ style }: { style?: React.CSSProperties }) {
  return <div className="pcard slot" style={style} aria-hidden="true" />;
}

export function MiniCards({ cards }: { cards: C[] }) {
  return (
    <span className="mini-cards">
      {cards.map((c, i) => (
        <span key={i} className={suit(c) === 1 || suit(c) === 2 ? "r" : ""}>
          {RANK[rank(c)]}
          {PIP[suit(c)]}
          {i < cards.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
