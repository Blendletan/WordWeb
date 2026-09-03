# Word Web

A Steiner-tree word puzzle: connect 3 target words into one web by typing
words that are one letter different from something already there, in as
few extra words as possible. Styled with the RMLP retro-puzzle-book
identity — bubbles rendered as a corkboard/thread web, not a plain
node-link graph, with a nine-step scripted tutorial that shares the same
drawing code as the live board.

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
index.html              shell: header, board, word-entry form, tutorial modal, share panel
css/
  rmlp-tokens.css        brand tokens (colors, type, spacing) — edit this to reskin
  word-web.css           page chrome only — no node/edge colors here, see bubble-theme.js
js/
  lib/
    wordgraph.js          adjacency accessor over data/words.json
    steiner.js             exact Dreyfus-Wagner Steiner-tree solver (par) + k=3 optimal-tree reconstruction (for Reveal Answer)
    puzzle-generator.js    samples valid target-word triples, seedable — this is what the daily puzzle's determinism runs on
  bubble-theme.js          shared bubble/thread drawing (gradients, shadows, curve math) — graph-view.js and tutorial.js both draw through this, nothing else
  graph-view.js            D3 force-directed rendering — nodes settle once, then get pinned; bubble size steps down in tiers as the web grows
  tutorial.js              the 9-step onboarding slideshow, click-to-advance
  rmlp-share-card.js        shareable result card (canvas image + emoji text)
  app.js                    game state, word-entry validation, daily puzzle + persistence, reveal, share hookup
data/
  words.json               5-letter word graph, giant component, profanity-filtered
assets/
  rmlp-logo-mark.svg        favicon / small mark
  rmlp-logo-full.svg        full lockup (not currently used in-game, available for future use)
```

**Why split like this:** the algorithm (`lib/`), the visual language
(`bubble-theme.js`), the two things that render it (`graph-view.js`,
`tutorial.js`), the game glue (`app.js`), and the styling (`css/`) don't
depend on each other's internals. A future game can reuse `lib/steiner.js`,
`bubble-theme.js`, and `rmlp-share-card.js` outright, and reskinning this
one is a `rmlp-tokens.css` edit, not a rewrite.

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
distinctly (the `'revealed'` kind in `bubble-theme.js` — a dulled rust
gradient, same visual family as the failure share card) so it's clear
which bubbles were theirs and which they were missing. Nothing already on
the board is touched or removed — reveal only ever adds. A revealed word
that bridges more than one existing branch attaches to all of them, same
as live play.

Tree reconstruction (`SteinerSolver.reconstructOptimalTreeK3`) is specific
to exactly 3 terminals — it uses the fact that for k=3 the optimal Steiner
tree is always the union of shortest paths from each terminal to whichever
single vertex minimizes the sum of the three distances to it. That's not
true in general for k=4+, so a future hard mode would need a proper
Dreyfus-Wagner backtrack instead of this shortcut.

Revealing is scored and shared as its own state, not folded into the
normal par comparison — see "Score naming" below.

## Two benchmarks, not one

Originally "par" *was* the true Steiner-tree minimum — mathematically
correct, but demoralizing in practice: it meant most players' best
realistic outcome was "not quite," never "good." Now there are two
separate numbers:

- **Perfect** (`perfectWords`) — the true minimum, unchanged, computed
  from the solver's edge count: `perfectWords = puzzle.par - (K - 1)`
  (a tree with `puzzle.par` edges has `puzzle.par + 1` nodes, K of which
  are the starting targets).
- **Par** (`parWords`) — `perfectWords + PAR_BONUS` (`PAR_BONUS = 3` in
  `js/app.js`). A deliberately crude placeholder, not a validated
  average — revisit once real completions exist to calibrate against.

There's no single verdict chip anymore (no more "PERFECT" / "+2" /
"REVEALED" badge) — just three quiet numbers, Perfect · Par · Words,
and the emotional framing lives in the share card's wording instead:

- Solved, `words ≤ perfectWords`: **"Perfect score"**
- Solved, `perfectWords < words ≤ parWords`: **"beat par by N"**
- Solved, `words > parWords`: **"+N over par"**
- Revealed (gave up): **"This one beat me!"**

**Score is still words added (`submittedWords.length`), not graph
edges** — see the git history / earlier design notes for why (a single
word bridging multiple branches creates multiple edges but is still one
word typed; scoring by edges would make the live counter jump
unpredictably relative to what the player just did).

The solved share card's row of cells now has three colors, not two:
gold up to `perfectWords`, a calmer teal for the cushion between
`perfectWords` and words actually used (still good, not optimal), red
only for cells past `parWords`. The failure card has **no cells at all**
— a "words found vs. optimal" metric was tried and dropped: there can be
more than one equally-short optimal path through the graph, and
measuring overlap against just the one path the reconstruction happens
to pick could tell a player who was genuinely one word from finishing
(via a different, equally valid route) that they'd barely found
anything — actively wrong, not just uninformative. The failure card
keeps a rust top-accent strip and rust-colored stat text as its only
visual distinction from a solved card.

## Visual design

The Perfect/Par/Words stats row (`.ww-stats-row`/`.ww-stat` in
`word-web.css`) uses the same classes on both the live page and inside
the tutorial modal — the value size was bumped noticeably (from 11px to
20px, label stays smaller for hierarchy) after review found it too small
to read comfortably in either place. One CSS change fixed both, since
they share the class rather than each having their own copy.

Bubble and thread rendering — gradients, drop shadows, the double-ring
"stamp" treatment on target words, and the curved corkboard-thread edges
(a quadratic bezier with a perpendicular bow, not a straight line) — all
live in `bubble-theme.js`, not in CSS and not duplicated per-file. Both
`graph-view.js` (the live, D3-physics-driven board) and `tutorial.js`
(the static scripted slideshow) draw through the same module, so they're
guaranteed to look alike by construction. Each gets its own `<defs>` id
prefix (`ww` / `tut`) so the two never collide if both happen to be in
the DOM at once.

Bubble size steps down in three tiers as the web grows past 10, then 16
nodes — shadow blur and ring offset scale down with it, proportionally,
so the smallest tier doesn't look muddy. Crossing a tier is the one
deliberate exception to "no jiggle" (see below): the board briefly
re-settles at the new size.

## Tutorial

Nine steps, click-to-advance (chosen over an auto-timer since this only
plays once per player, gated by the `ww-seen-instructions-v3`
localStorage flag — bump that version string if the content changes
again and returning players should see it once more). Uses BASIS /
PANEL / PAGED, a real graph-verified puzzle with a genuine near-miss
(typing CANES instead of BANES costs exactly one extra word), not an
invented example. See the design notes for how it was found — it needed
a specific shape (a plausible wrong turn late in the solve, not an
early, arbitrary one) that took real graph search, not hand-authoring.

## Loading state

Before the daily puzzle finishes generating (fetch + `PuzzleGenerator`),
three dashed, softly pulsing outlines stand in for the eventual bubbles
(`#board-loading` in `index.html`), staggered out of sync with each
other rather than pulsing in unison. The entry field, submit button, and
Reveal Answer button are all `disabled` by default in the HTML itself,
not just by app logic — `startPuzzle()` is what enables them, so a fast
typer on a slow connection can't submit before `graph` exists (this was
a real bug caught during design review, not a hypothetical).

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

**That per-node pinning has a real failure mode: bursts.** Reveal Answer
and replaying a saved session on load both add several nodes back-to-back
with no render in between (nothing paints between synchronous statements
in a browser). Left unguarded, each addition in the burst pins everything
added *so far in the same burst* at its raw, unsettled spawn position —
visible overlap, not just tight spacing, since physics never gets a
chance to spread that group apart. Normal one-at-a-time play never hits
this; typing a word takes hundreds of milliseconds at minimum, and
animation frames render every ~16ms, so there's always time to settle
between submissions. `GraphView.beginBatch()`/`endBatch()` fix this:
`app.js` wraps both burst call sites (`revealAnswer()`, the replay loop
in `loadDailyPuzzle()`) so the whole group of new nodes settles together
before anything gets pinned, instead of pinning progressively as each one
lands. Verified with the closest-pair distance between every node after
a burst add, across 15 trials with unseeded randomness, run to full
settle (alpha below the simulation's own stop threshold, same as a real
page would reach) — worst case 72px between centers against a ~66px
overlap threshold at the largest bubble tier, every trial.

Two related fixes: a continuous bounds-clamping force keeps nodes inside
the board on every tick, not just when they're first placed (mutual
repulsion between enough nodes was pushing some of them past the edges
over time). And bubble size steps down in tiers as the web grows past 10,
then 16 nodes, rather than scrolling or shrinking the whole board — seeing
the whole web at a glance matters more here than fixed bubble size.
Crossing a tier is the one deliberate exception to "no jiggle": the board
briefly re-settles at the new size, since leaving bubbles pinned at
spacing sized for bigger bubbles would look broken once everything else
shrinks around them. All of this (tier thresholds, shadow/ring scaling)
lives in `bubble-theme.js`, shared with the tutorial — see "Visual
design" above.

## Verified before shipping

Algorithm layer (unchanged by this redesign, re-confirmed anyway):
- The JS Steiner solver was cross-checked against a Python reference
  implementation on the same graph — exact match on every trial.
- The k=3 optimal-tree reconstruction used by Reveal Answer was checked
  against the solver's own par value across 300 puzzles — always matches
  exactly, and always includes all 3 targets.
- 200+ generated puzzles were checked end-to-end: the optimal Steiner tree
  for each is reachable via the actual type-to-connect game mechanic in
  exactly `perfectWords` words, not just correct as an abstract number.
- Reveal Answer was tested after partial play: it always completes the
  puzzle, never touches or removes a word the player had already found,
  and the player's own word count never gets inflated by the words
  reveal adds.
- The words-vs-edges equivalence at solve time was checked against 40
  solved games that included deliberately wasted/inefficient detour
  moves and bridging, not just optimal play.
- Puzzle generation was seed-tested for determinism (same local date →
  same puzzle every time).

Redesign layer (new for this pass):
- `GraphView` was run through a full headless playthrough in `jsdom`
  (real `d3` physics, not a stand-in) — 8 nodes including a bridged
  merge and a tier-crossing addition, checking every rendered `<path>`
  for malformed/NaN geometry and every node for a valid gradient
  reference. Also checked: all nodes stay within the bounds-clamped
  region after real force-simulation ticks, and `reset()` correctly
  returns to the tier-1 radius.
- `Tutorial` was click-driven through all 9 steps in `jsdom`, checking
  every edge path across every step for malformed geometry, confirming
  the ghost edge and CANES recoloring appear exactly at steps 8–9, and
  confirming the final "Next" click closes the modal.
- `rmlp-share-card.js`'s canvas output was rendered for real (via
  `node-canvas`, not just code-reviewed) for all three solved variants
  (perfect / beat-par / over-par) and the failure variant, checked for
  correct dimensions, and visually inspected as PNGs before shipping —
  caught two real gaps this way: the failure card's stat text wasn't
  picking up the accent color (fixed), and the text-share output left a
  blank line when there were no cells (fixed).
- A full end-to-end integration test loaded the actual `index.html` in
  `jsdom`, served the real `data/words.json` over a mocked `fetch`, and
  ran every real script in load order (including real `d3`) — then
  drove an entire game through the real form-submission handler (not a
  logic stand-in): solved a live-generated puzzle at a Perfect score,
  confirmed the loading placeholder hides and the board un-hides,
  confirmed the tutorial auto-shows on a first visit and not on a
  second, and confirmed a simulated tab reopen (fresh `jsdom` instance,
  same `localStorage`) resumes to an identical state.
- The reveal-confirmation flow was driven end-to-end: opening the
  confirm dialog doesn't reveal anything, Cancel leaves the entry field
  live, and only a confirmed reveal disables input and shows the share
  panel.
- A stale previous-day save (`dayNumber: 1` when the real day is later)
  was confirmed to be ignored — a fresh puzzle loads rather than
  incorrectly resuming.

Post-launch fixes (from actually playing the shipped redesign, not
review alone — the clustering bug specifically could never have shown up
in a static mockup, only in live play):
- Reproduced the burst-add clustering bug first, on the exact scenario
  that causes it (several `addNode()` calls with no ticks in between —
  what `revealAnswer()` and the replay-on-load path both do), confirming
  it before writing a fix for it: closest pair landed 28px apart against
  a ~66px no-overlap threshold.
- After the `beginBatch()`/`endBatch()` fix, re-ran the same reproduction
  across 15 trials with unseeded randomness, each run to full settle
  (alpha below the simulation's own stop threshold) — worst case 72px,
  every trial.
- Re-ran the original `GraphView` regression suite (node/link counts,
  bridging, solved-state styling, tier transitions, bounds clamping,
  `reset()`) to confirm the batching change didn't disturb anything else.
- Also tried dispatching several normal single-word submissions with no
  delay between them, purely out of caution — this did reproduce
  clustering too, but isn't a realistic concern: typing a 5-letter word
  takes hundreds of milliseconds at minimum even for a fast typist, and
  animation frames render roughly every 16ms, so real play always has
  time to settle between submissions. Noted rather than "fixed," since
  there's nothing to fix that a human could actually trigger.

## Open items / not done here

- **Par calibration.** `PAR_BONUS = 3` is a placeholder, explicitly not
  a validated average — see "Two benchmarks, not one" above.

- **k=4 hard mode.** Only the k=3 standard puzzle is wired up — see the
  Reveal Answer note above on why that reconstruction shortcut doesn't
  extend to k=4 as-is.
- **Hints.** Not implemented; explicitly deferred until after feedback.
- **Word-list review.** Flagged above — worth your own look.
- **Archive/back-catalog.** There's no way to play a past day's puzzle
  right now — today's is the only one reachable.
- **Own server / hosting move.** Still a static GitHub Pages site.

