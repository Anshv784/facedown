import { Link } from "react-router-dom";
import { CONTRACT } from "../lib/config";

export function HowPage() {
  return (
    <main className="prose" style={{ maxWidth: 900 }}>
      <div className="eyebrow">How it's fair</div>
      <h1>Online poker always asked you to trust the dealer.</h1>
      <p>
        In 2007 and 2008, insiders at two of the biggest poker sites used hidden "superuser" accounts that could see
        every player's hole cards. They took millions before players worked it out from impossible win rates. Every
        online card room since has the same shape: one server shuffles, deals, and knows every card. You trust that
        nobody is looking.
      </p>
      <p>
        <strong>Facedown removes that server.</strong> No one runs a machine that knows the cards: not us, not the
        players, not the house bots.
      </p>

      <div className="panel flow">
        <svg viewBox="0 0 760 300" role="img" aria-label="Diagram: the table contract asks the OutLayer enclave to deal; the enclave draws VRF randomness, commits to a secret, seals hole cards to each player's key; the contract verifies and stores only sealed cards; at the end the secret is revealed and the contract audits the deck.">
          <defs>
            <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill="#f2b33d" />
            </marker>
          </defs>
          <g fontFamily="Barlow, sans-serif" fontSize="13" fill="#eceff3">
            <rect x="10" y="100" width="170" height="100" rx="10" fill="#1c2025" stroke="#363d47" strokeWidth="1.5" />
            <text x="95" y="130" textAnchor="middle" fontWeight="600">Your browser</text>
            <text x="95" y="152" textAnchor="middle" fill="#a8b0bb" fontSize="12">ed25519: signs moves</text>
            <text x="95" y="170" textAnchor="middle" fill="#a8b0bb" fontSize="12">x25519: opens your cards</text>

            <rect x="295" y="100" width="170" height="100" rx="10" fill="#232830" stroke="#f2b33d" strokeWidth="1.5" />
            <text x="380" y="130" textAnchor="middle" fontWeight="700" fill="#fff">Table contract</text>
            <text x="380" y="152" textAnchor="middle" fill="#fff" fontSize="12">rules, chips, timeouts</text>
            <text x="380" y="170" textAnchor="middle" fill="#fff" fontSize="12">verifies + audits</text>

            <rect x="580" y="70" width="170" height="160" rx="10" fill="#0e4a30" stroke="#363d47" strokeWidth="1.5" />
            <text x="665" y="98" textAnchor="middle" fill="#fff" fontWeight="700">Dealer enclave</text>
            <text x="665" y="116" textAnchor="middle" fill="#fff" fontSize="11.5">OutLayer · Intel TDX</text>
            <text x="665" y="146" textAnchor="middle" fill="#fff" fontSize="12">VRF randomness</text>
            <text x="665" y="166" textAnchor="middle" fill="#fff" fontSize="12">secret salt (sealed key)</text>
            <text x="665" y="186" textAnchor="middle" fill="#fff" fontSize="12">shuffle · seal · bots</text>

            <path d="M180 135H290" stroke="#f2b33d" strokeWidth="1.4" markerEnd="url(#a)" />
            <text x="235" y="126" textAnchor="middle" fontSize="11" fill="#f2b33d">signed move</text>
            <path d="M290 168H184" stroke="#f2b33d" strokeWidth="1.4" markerEnd="url(#a)" />
            <text x="237" y="186" textAnchor="middle" fontSize="11" fill="#f2b33d">sealed cards</text>

            <path d="M465 125H575" stroke="#f2b33d" strokeWidth="1.4" markerEnd="url(#a)" />
            <text x="520" y="116" textAnchor="middle" fontSize="11" fill="#f2b33d">deal / reveal job</text>
            <path d="M575 175H469" stroke="#f2b33d" strokeWidth="1.4" markerEnd="url(#a)" />
            <text x="522" y="194" textAnchor="middle" fontSize="11" fill="#f2b33d">proof + commitment</text>

            <text x="380" y="262" textAnchor="middle" fill="#a8b0bb" fontSize="12">
              End of hand: salt revealed → contract rebuilds the deck → any mismatch voids the hand and refunds everyone
            </text>
            <text x="380" y="40" textAnchor="middle" fill="#a8b0bb" fontSize="12">
              Only ciphertext and commitments ever touch the chain while cards are live
            </text>
          </g>
        </svg>
      </div>

      <h2>1. A deck nobody chose</h2>
      <p>
        Each hand starts with a request to OutLayer's verifiable random function, seeded with the table and hand
        number. The enclave returns a 32-byte output and an ed25519 signature over <code>vrf:request:caller:seed</code>.
        The contract checks that signature against OutLayer's published key, checks that the output is the SHA-256 of
        the signature, and checks the seed is this exact hand. A dealer can't ask twice and keep the deck it likes.
      </p>

      <h2>2. A secret locked in before the deal</h2>
      <p>
        VRF output is public, so on its own anyone could shuffle the deck. The dealer mixes in a <strong>salt</strong>:
        an HMAC of the hand under a key that was generated inside the enclave and can only be read by this exact build
        of the dealer program. Before any card is dealt, the dealer posts <code>sha256(salt)</code> on chain. From that
        moment the deck is fixed, but nobody outside the enclave knows it.
      </p>

      <h2>3. Cards only you can open</h2>
      <p>
        When you joined, this browser made two keys. The dealer encrypts your two cards to your x25519 key
        (ephemeral X25519, ChaCha20-Poly1305, bound to this table, hand and seat), and the contract stores only the
        ciphertext. Your browser decrypts it locally. Flop, turn and river are revealed by the enclave one street at a
        time, only when the contract's betting rules say so.
      </p>

      <h2>4. Bots that play blind, like you</h2>
      <p>
        House bots run inside the same enclave. Each bot is given its own two cards and the public table, never anyone
        else's cards or the rest of the deck. It estimates its odds by dealing out the unknown cards hundreds of times,
        then plays to its style. The contract checks every bot move is legal.
      </p>

      <h2>5. The audit, before anyone is paid</h2>
      <p>
        When the hand ends, the enclave reveals the salt. The contract recomputes the commitment, rebuilds the deck from
        (VRF output, salt), and checks it produced the board everyone saw. Only then does it score the hands and move
        chips. If anything is off, or the dealer stops answering, the hand is voided and every chip goes back. You can
        re-run the same audit in your browser on any finished hand.
      </p>

      <h2>What you still trust</h2>
      <ul>
        <li>
          <strong>The enclave hardware.</strong> Intel TDX keeps the dealer's memory private. A broken TEE could leak
          live cards; it still couldn't change the deck after the commitment, because the audit would catch it.
        </li>
        <li>
          <strong>OutLayer's VRF key.</strong> Its output is checked, but the key lives in OutLayer's own TEE.
        </li>
        <li>
          <strong>Your device.</strong> Your keys live in this browser. Back them up from your profile.
        </li>
      </ul>
      <p>
        Everything else is public: the contract is <code>{CONTRACT}</code>, the dealer and the rules are open source.{" "}
        <Link to="/play">Go play a hand</Link> and audit it.
      </p>
    </main>
  );
}
