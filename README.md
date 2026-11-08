# Facedown

**No-limit Hold'em on NEAR where nobody can see your cards: not the other players, not the house bots, not us.**

Live: https://facedown.anshverma.tech · Contract: `facedown.testnet` · Dealer: OutLayer project `facedown.testnet/dealer`

---

## The problem

Online poker has always run on one assumption: the server that shuffles the deck and knows every card is honest.

That assumption has failed in public. In 2007–2008, insiders at Absolute Poker and UltimateBet used hidden "superuser" accounts that could see opponents' hole cards and took millions before players caught them through impossible win rates. The structure that allowed it is still how every online card room works: one machine shuffles, deals, and sees everything.

Putting poker "on chain" doesn't fix this by itself. A blockchain is public, so it can't hold a secret deck. Existing on-chain card games either trust a server anyway or use multi-party ZK shuffles that take minutes per hand and need every player online to decrypt every card.

## What Facedown does

The deck lives in a place no one can read, and every hand proves afterwards that it wasn't tampered with.

| Who | What they can see during a hand |
| --- | --- |
| You | Your two cards (decrypted in your browser) and the public board |
| Other players | Their own two cards |
| House bots | Their own two cards. They run in the enclave but are only given their own hand |
| The contract | Ciphertexts, a commitment, the VRF proof |
| Us (the operator) | The same as anyone: ciphertexts and commitments |
| The dealer enclave | The deck. It's an Intel TDX enclave running a public, hash-pinned program |

When the hand ends, the full deck becomes public, and the contract checks it before paying anyone.

## How a hand works

```
 browser ──signed move──▶ table contract ──deal job──▶ OutLayer TEE (dealer)
    ▲                         │    ▲                       │
    └──── sealed cards ───────┘    └── VRF proof + commit ─┘
```

1. **Randomness nobody chose.** The contract asks the dealer to deal. The dealer calls OutLayer's VRF with the seed `facedown-{table}-{hand}`. The contract verifies the ed25519 proof against OutLayer's VRF key with `env::ed25519_verify`, checks `output == sha256(signature)`, and checks that the alpha names this exact hand. A dealer can't re-roll.
2. **A secret locked in before the deal.** VRF output is public, so the dealer mixes in a salt: `HMAC-SHA256(DEALER_KEY, contract | table | hand | vrf)`. `PROTECTED_DEALER_KEY` is generated inside the enclave by OutLayer and bound to this build's hash, so no human has ever seen it. The dealer posts `sha256("facedown/salt/v1" ‖ salt)` on chain before any card is shown. From then on the deck is fixed.
3. **The deck.** `shuffle(sha256("facedown/deck/v1" ‖ vrf ‖ salt))`: Fisher–Yates driven by a SHA-256 counter stream with rejection sampling. Player *j* gets cards `2j, 2j+1`; the board is the next five.
4. **Cards only you can open.** On signup your browser makes an ed25519 key (signs moves) and an x25519 key (opens cards). The dealer seals your two cards with ephemeral X25519 → SHA-256 KDF → ChaCha20-Poly1305, with `facedown/{contract}/{table}/{hand}/{seat}` as associated data, so a ciphertext can't be replayed into another hand or seat. The contract stores only the ciphertext.
5. **Streets on demand.** Flop, turn and river are separate dealer jobs. The enclave re-derives the same deck and reveals only that street, only when the contract's betting rules say it's time.
6. **Bots that play blind.** Bots (Rook, tight; Vega, aggressive; Pip, loose) act inside the enclave. Each one gets its own two cards and the public state, and estimates its equity by Monte Carlo over the cards it can't see. The contract checks every move is legal; an illegal one becomes a fold or check.
7. **The audit, before payout.** At the end the dealer reveals the salt. The contract recomputes the commitment, rebuilds the deck, and checks the board, then scores every hand and pays out. If anything fails, or the dealer goes silent for five minutes, the hand is **voided and every chip is refunded**.
8. **Verify it yourself.** Every finished hand has a page that re-runs the whole audit in your browser from public chain data: VRF signature, hash, commitment, rebuilt 52-card deck.

## What's technically interesting

- **No wallet, real signatures.** Players are browser keypairs. Every move is the string `facedown|<contract>|<player>|<nonce>|<payload>`, signed with ed25519 and verified in the contract. A relayer pays gas through a function-call key that can only call `relay` and `advance`, so it can't forge moves or touch chips.
- **TEE + VRF + commitment, layered.** A TEE alone means "trust Intel"; a VRF alone means a public deck. Here the VRF fixes the randomness, the commitment fixes the deck, the TEE keeps it private while it matters, and the contract audits it afterwards. A broken enclave could at worst leak live cards; it still couldn't change the deck without failing the audit.
- **One engine, three runtimes.** `facedown-core` (`no_std`) holds the deck, a 7-card evaluator and full no-limit betting: side pots, short all-ins that don't reopen raising, heads-up blind rules, odd chips. The contract and the enclave run the same code, and the browser runs a TypeScript port pinned to Rust-generated vectors (6 full decks, 500 hand scores, a sealed-card vector).
- **Liveness without trust.** Anyone can call `advance(table)` to start a hand, retry a dealer job, or play a timeout. Thirty seconds to act, then a check or fold; two timeouts sit you out. Dealer jobs retry up to three times, then the hand is voided with refunds.

## Repository

```
crates/facedown-core   deck, evaluator, betting engine, audit        (22 tests)
contracts/table        NEAR contract: players, tables, hands, dealer (13 tests)
dealer                 OutLayer WASI program: deal, reveal, bots     (9 tests)
app                    React app + Vercel relayer functions          (8 tests)
```

```bash
cargo test                                   # core + contract
cd dealer && cargo test && cargo build --release --target wasm32-wasip2
cd app && npm i && npm test && npm run dev   # open /?mock=flop to see the UI without a chain
```

## Deploying your own

```bash
cd contracts/table && cargo near build non-reproducible-wasm
near contract deploy <contract> use-file ../../target/near/facedown_table/facedown_table.wasm \
  with-init-call new json-args '{"owner":"<you>","dealer":{"outlayer":"outlayer.testnet","project_id":"<contract>/dealer","secrets_owner":"<contract>","secrets_profile":"default","vrf_pubkey":"c0c5aeae1688c2f7cc2350aae1ee3ce96eddc0de84d678db873de48268f8cfa8"}}' ...
outlayer deploy dealer <url of dealer wasm>
outlayer secrets set FACEDOWN_CONTRACT=<contract>
outlayer secrets set --generate PROTECTED_DEALER_KEY:hex32 --build <dealer wasm sha256>
```

The app reads `VITE_CONTRACT`; the relayer needs `FACEDOWN_CONTRACT`, `RELAYER_ACCOUNT` and `RELAYER_KEY` (a function-call key limited to `relay` and `advance`).

## What you still trust

- **Intel TDX** for privacy of live cards (not for correctness: the audit covers that).
- **OutLayer's VRF key**, which lives in OutLayer's own TEE.
- **Your browser** for your keys. Back them up from the profile page.

## Limits, stated plainly

- Testnet and play chips only. No real money, by design.
- Each dealer step is an OutLayer job, so a street takes a few seconds and a hand with three bots takes about a minute.
- After a hand ends, all hole cards, including folded ones, become public. That is what lets anyone audit the deck.

Also by the same builder for this hackathon: [Oathline](https://github.com/Anshv784/oathline), verifiable AI rulings for DAOs and markets via OutLayer.

MIT licensed.
