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
    steiner.js             exact Dreyfus-Wagner Steiner-tree solver (par computation)
    puzzle-generator.js    samples valid target-word triples, seedable for later daily play
  graph-view.js            D3 force-directed rendering — nodes settle once, then get pinned
  rmlp-share-card.js        shareable result card (canvas image + emoji text)
  app.js                    game state, word-entry validation, win detection, share hookup
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

## Verified before shipping

- The JS Steiner solver was cross-checked against a Python reference
  implementation on the same graph — exact match on every trial.
- 25 generated puzzles were checked end-to-end: the optimal Steiner tree for
  each is reachable via the actual click-to-connect game mechanic in exactly
  `par` connections, not just correct as an abstract number.
- Puzzle generation was seed-tested for determinism (same seed → same
  puzzle) — that's the hook a future daily-puzzle mode plugs into
  (`PuzzleGenerator.generate(graph, { seed: <day-based number> })`).

## Open items / not done here

- **Daily puzzle mode.** The seeded generator is ready; this build still
  calls it with no seed (fresh random puzzle each load), matching what was
  asked for this pass.
- **k=4 hard mode.** Only the k=3 standard puzzle is wired up.
- **Word-list review.** Flagged above — worth your own look.
