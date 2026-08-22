# Word Web

A Steiner-tree word puzzle: connect 3 target words into one web by typing
words that are one letter different from something already there, in as
few extra words as possible. Styled with the RMLP retro-puzzle-book
identity.

## How the entry mechanic works

There's no list of valid next words shown — that's deliberate, per the
design brief: figuring out a word that fits is the game. The player types
a 5-letter word and it's checked against two independent rules:

1. Is it a real word in `data/words.json`?
2. Is it exactly one letter different from a word already in the web?

If either check fails, the rejection reason is shown (wrong length, not a
recognized word, already placed, or a real word that just doesn't connect
to anything yet).

A submission can be adjacent to more than one thing already in the web —
when that happens, it's connected to **one representative per distinct
connected component it touches**, not one edge per adjacent word. That
distinction matters: word degree in this graph averages ~6, so a typed
word is often incidentally adjacent to a second word that's already in the
*same* already-merged branch. Drawing an edge for that too would be a
wasted, redundant connection that makes par unreachable through no fault
of the player's word choice — confirmed by simulating 200 generated
puzzles end-to-end with this exact mechanic and checking par was always
reachable. Connecting once per component is both sufficient (a word that
bridges 3 separate branches at once still merges all 3) and never wasteful.

## Running it

Everything is static — no build step, no server-side code. Any static host
works (GitHub Pages, itch.io as a zipped folder, or just opening
`index.html` locally, though `fetch()` for `data/words.json` needs an actual
HTTP server for most browsers — `python3 -m http.server` from this folder
is the fastest way to check it locally).

## Structure

```
index.html              shell: header, board, word-entry form, instructions modal, share panel
css/
  rmlp-tokens.css        brand tokens (colors, type, spacing) — edit this to reskin
  word-web.css           game layout/styling, entirely built on the tokens above
js/
  lib/
    wordgraph.js          adjacency accessor over data/words.json
    steiner.js             exact Dreyfus-Wagner Steiner-tree solver (par) + k=3 optimal-tree reconstruction (for Reveal Answer)
    puzzle-generator.js    samples valid target-word triples, seedable — this is what the daily puzzle's determinism runs on
  graph-view.js            D3 force-directed rendering — nodes settle once, then get pinned; bubble size steps down in tiers as the web grows
  rmlp-share-card.js        shareable result card (canvas image + emoji text)
  app.js                    game state, word-entry validation, daily puzzle + persistence, reveal, share hookup
data/
  words.json               5-letter word graph, giant component, profanity-filtered
assets/
  rmlp-logo-mark.svg        favicon / small mark
  rmlp-logo-full.svg        full lockup (not currently used in-game, available for future use)
```

**Why split like this:** the algorithm (`lib/`), the rendering (`graph-view.js`),
the game glue (`app.js`), and the styling (`css/`) don't depend on each
other's internals. A future game can reuse `lib/steiner.js` and
`rmlp-share-card.js` outright, and reskinning this one is a `rmlp-tokens.css`
edit, not a rewrite.

## Daily puzzle

There's exactly one puzzle a day, deterministic per the player's **local
calendar date** — same approach Wordle uses, so players in different
timezones may roll over at different real-world moments. That's a known
tradeoff of going local-date over a fixed UTC rollover, not a bug: it
needs no backend, which fixed-rollover consistency would.

Day numbering and the seed both come from `EPOCH_DATE` near the top of
`js/app.js` — move that constant if you want to renumber (e.g. back-date
to when the game actually first went live, rather than whenever this
feature shipped).

## Resuming a session

Progress persists in `localStorage` under `ww-daily-progress`: the day
number, the ordered list of words the player typed, and (if used) the
ordered list of words Reveal Answer added. On load, if the stored day
matches today, the daily puzzle is regenerated (deterministic from the
seed) and every stored word is replayed through the same commit logic
live play uses — so the rebuilt state is exactly what it would have been
had the tab never closed, not an approximation. If the stored day is
from a previous day, it's just ignored and a fresh puzzle loads.

## Reveal Answer

A confirm step guards it — it's irreversible and ends the day's puzzle,
so a stray tap shouldn't cost the whole thing. On confirm, every word from
the optimal solution the player hadn't already found gets added, styled
distinctly (`.is-revealed` in `word-web.css`) so it's clear which bubbles
were theirs and which they were missing. Nothing already on the board is
touched or removed — reveal only ever adds. A revealed word that bridges
more than one existing branch attaches to all of them, same as live play.

Tree reconstruction (`SteinerSolver.reconstructOptimalTreeK3`) is specific
to exactly 3 terminals — it uses the fact that for k=3 the optimal Steiner
tree is always the union of shortest paths from each terminal to whichever
single vertex minimizes the sum of the three distances to it. That's not
true in general for k=4+, so a future hard mode would need a proper
Dreyfus-Wagner backtrack instead of this shortcut.

Revealing is scored and shared as its own state, not folded into the
normal par comparison — see "Score naming" below.

## Score naming

- Status chip: **Perfect** (matched par exactly) / **+N** (N over par) /
  **Revealed** (gave up).
- Share text: **"Perfect score"** (full phrase, more room there) /
  **"+N over par"** / **"This one beat me!"**.
- The revealed share card's row of cells shows how far the player's own
  play got before giving up — gold for connections they actually made,
  dull for the rest of par's length — rather than just being blank or a
  flat "you lost" bar.

## Share link

`GAME_URL` in `js/app.js` is the URL embedded in both the shareable image
and the copy-text output. Update it there if the game ever moves.

## On the word list

`data/words.json` was rebuilt from `/usr/share/dict/american-english`,
filtered with `better-profanity`, then manually reviewed — restoring common
words the filter over-flagged (e.g. "prick", "slave", "screw", "naked",
"urine" — all have clearly dominant non-vulgar meanings) while keeping
actual slurs and vulgarity out. That review is a judgment call and worth
your own pass — the full removed list and reasoning are in the build script
below if you want to adjust it.

Rebuilding after any change to the word list is required, not optional —
removing a word can silently disconnect others from the graph (an
articulation-point effect), so the giant component has to be recomputed
from scratch each time, not just patched.

## What's stationary now

The D3 force simulation runs briefly when a node is added (to find a
non-overlapping spot near its parent), then every node gets pinned (`fx`/`fy`
set) so it stops moving. Adding a new node re-pins everything else first, so
only the new node (and merges between existing pinned nodes, which don't
move at all) animate.

Two related fixes: a continuous bounds-clamping force keeps nodes inside
the board on every tick, not just when they're first placed (mutual
repulsion between enough nodes was pushing some of them past the edges
over time). And bubble size steps down in tiers as the web grows past 10,
then 16 nodes, rather than scrolling or shrinking the whole board — seeing
the whole web at a glance matters more here than fixed bubble size.
Crossing a tier is the one deliberate exception to "no jiggle": the board
briefly re-settles at the new size, since leaving bubbles pinned at
spacing sized for bigger bubbles would look broken once everything else
shrinks around them.

## Verified before shipping

- The JS Steiner solver was cross-checked against a Python reference
  implementation on the same graph — exact match on every trial.
- The k=3 optimal-tree reconstruction used by Reveal Answer was checked
  against the solver's own par value across 300 puzzles — always matches
  exactly, and always includes all 3 targets.
- 200+ generated puzzles were checked end-to-end: the optimal Steiner tree
  for each is reachable via the actual type-to-connect game mechanic in
  exactly `par` connections, not just correct as an abstract number.
- Reveal Answer was tested after partial play: it always completes the
  puzzle, never touches or removes a word the player had already found,
  and the player's own "connections" count never gets inflated by the
  words reveal adds.
- The persist/replay path was tested by simulating a session, saving just
  the ordered word list, then rebuilding state against a freshly
  regenerated puzzle from that list alone — the rebuilt web, edge count,
  and connections count all came out identical to the original session,
  across 10 trials.
- Puzzle generation was seed-tested for determinism (same local date →
  same puzzle every time).

## Open items / not done here

- **k=4 hard mode.** Only the k=3 standard puzzle is wired up — see the
  Reveal Answer note above on why that reconstruction shortcut doesn't
  extend to k=4 as-is.
- **Hints.** Not implemented; explicitly deferred until after feedback.
- **Word-list review.** Flagged above — worth your own look.
- **Archive/back-catalog.** There's no way to play a past day's puzzle
  right now — today's is the only one reachable.
- **Own server / hosting move.** Still a static GitHub Pages site.

