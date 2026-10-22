# Paxos playground

An interactive, single-decree Paxos simulation for developers learning the protocol. Five servers (A–E) are each a proposer and an acceptor. Nothing runs on a timer unless you turn on autoplay. You deliver, delay, or drop every message.

## Run and build

```bash
npm install
npm test          # vitest, core safety invariants
npm run dev       # http://localhost:5173/paxos/
npm run build     # typecheck + static bundle in dist/
npm run preview   # serve dist/ at http://localhost:4173/paxos/
```

`npm run build` writes a static site to `dist/`. Vite's `base` is `/paxos/`, so asset URLs are `/paxos/assets/...`. Copy the **contents** of `dist/` into the `/paxos/` directory of the GitHub Pages site (the one served at `naijei.com/paxos`). There is no server code. Routing is a URL hash (`#/c/first`, `#/c/crash`, and so on).

GitHub Actions (`.github/workflows/ci.yml`) runs `npm test` and `npm run build` on push and on pull requests.

## A short primer

Single-decree Paxos chooses **one value** even when messages are lost, reordered, or delayed, and when servers crash. It does not, by itself, promise that a value will be chosen soon.

Each server keeps three durable acceptor facts, plus one volatile opinion:

- **Highest promised ballot.** After promising ballot `n`, the acceptor rejects every lower ballot.
- **Last accepted ballot and value.** The latest value it actually accepted.
- **What it knows was chosen.** Empty until it hears a majority of `Accepted` replies or a `Learn` message. A restart clears this. It does not clear the promise or the last accept.

Ballots are `round.server`, such as `1.A` or `2.E`. A higher round wins. If the round is equal, the later server letter wins, so `1.D` is higher than `1.A`, and `2.A` is higher than `1.E`. A server only mints a ballot higher than the ballots it has seen, so two servers never reuse one number.

**Phase 1.** The proposer sends `Prepare`. An acceptor promises if the ballot is at least as high as anything it has promised, and it reports the value it has accepted, if any.

**Phase 2.** The first three promises (including the proposer's own) are the quorum. If any of them reports an accepted value, the proposer **must** send the value from the highest accepted ballot in that quorum. Otherwise it may send the value it wanted. A promise that arrives later does not change the choice. An acceptor accepts unless it has promised a higher ballot.

**Chosen.** A value is chosen when **3 of these 5** acceptors have accepted the same ballot and value. That is a fact about the disks. The global Chosen banner tracks it. Each server's "knows chosen" line can disagree until `Learn` arrives, and the playground says so.

**Why a later proposer cannot change it.** Any new quorum of three overlaps the three who already accepted. The overlap reports the chosen value, so phase 2 repeats it.

**Why an unfinished accept does not bind everyone.** One acceptor's `red` matters only if that acceptor is inside the quorum you actually used. A quorum that never heard about `red` may still propose `blue`. If `blue` then gets a majority, `red` was never chosen.

**Why a 3/2 split matters.** Majority is 3 of the whole set, not a majority of whoever you can reach. The side of three can choose. The pair cannot.

**Why dueling proposers stall.** A higher ballot makes acceptors reject the lower one. That keeps the decree safe and can also stop any ballot from finishing. Liveness needs something outside the ballot rule, usually a stable leader.

## Challenges

1. **Make a decision.** Three servers accept the same proposal. Notice the banner light before every server knows.
2. **Crash the proposer.** `$80` is already chosen, and A died before announcing it. Propose `$50` and watch the quorum force `$80`.
3. **Unfinished proposal.** Only A accepted `red`. Propose `blue`. Delay A's promise and the quorum may choose blue; include it and you must carry red.
4. **Split 3/2.** Which side can choose?
5. **Dueling proposers.** Interrupt three ballots with a higher one. Safe, and nothing is chosen.

Free play has the same controls and no goal. Undo walks back one action. Reset restores the challenge.
