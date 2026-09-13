# Word Web

Word Web is a static daily word puzzle. The player starts with three five-letter words
and adds one-letter substitutions until all three belong to one connected web. Fewer
submitted words produce a better score.

## Game rules

- A submission must be exactly five letters and exist in `data/words.json`.
- It must differ by exactly one letter from at least one word already on the board.
- One submission can bridge multiple disconnected branches at once.
- A new word connects once to each distinct component it touches, avoiding redundant
  same-component edges.
- The score is the number of words submitted by the player, not the number of edges.
- There is no undo.

## Running locally

There is no build step. Serve the repository with any static HTTP server; opening
`index.html` directly usually prevents `fetch()` from loading `data/words.json`.

For example:

```text
python3 -m http.server
```

This is the WordWebDebug staging repository. GitHub Pages automatically deploys its
`main` branch. Production is maintained separately and is not automatically updated by
this repository.

## Repository structure

```text
index.html                  Page shell, controls, dialogs, completion panel, footer
css/
  rmlp-tokens.css           Page-level brand tokens
  word-web.css              Page and component styling
js/
  app.js                    Game state, UI orchestration, persistence, completion flow
  rmlp-share-card.js        Canvas result preview and plain-text result generation
  graph-view.js             D3 graph rendering and layout
  bubble-theme.js           Graph-specific bubble and thread drawing
  tutorial.js               Nine-step onboarding slideshow
  lib/
    wordgraph.js             Word graph accessor
    steiner.js               Exact Steiner solver and k=3 tree reconstruction
    puzzle-generator.js      Deterministic target-word selection
data/
  words.json                Five-letter production word graph
tools/
  build_word_graph.py       Word-graph rebuild utility
assets/
  rmlp-logo-mark.svg        Small logo mark and favicon
  rmlp-logo-full.svg        Full logo lockup
```

Page styling should use the variables in `css/rmlp-tokens.css`. Bubble gradients,
shadows, rings, and thread curves live in `js/bubble-theme.js` because both the live
board and tutorial render through that module.

## Daily puzzle and persistence

The puzzle is deterministic from the player's local calendar date. Day numbering and
the seed originate from `EPOCH_DATE` in `js/app.js`. Players in different time zones can
roll over to the next puzzle at different real-world times.

Progress is stored under `ww-daily-progress` in `localStorage`. The saved data contains
the day number, submitted words, revealed solution words, and terminal status. When the
saved day matches today, `js/app.js` regenerates the same puzzle and replays the stored
words through the normal commit logic. A save from another day is ignored.

## Scoring

The application displays three values:

- **Perfect** (`perfectWords`) — the true minimum number of additional words, derived
  from the exact Steiner solver.
- **Par** (`parWords`) — `perfectWords + PAR_BONUS`.
- **Words** — `submittedWords.length`, the player's actual score.

`PAR_BONUS` is currently `3`. It is a product choice rather than a measured average.

Solved result wording is based on the relationship between Words, Perfect, and Par:

- At or below Perfect: `Perfect score`
- Above Perfect and at or below Par: `beat par by N`
- Above Par: `+N over par`
- Revealed: `This one beat me!`

The canvas result preview uses gold cells through Perfect, teal cells between Perfect
and Par, and red cells above Par. Revealed results omit cells because multiple equally
short optimal paths can make overlap with one reconstructed path misleading.

## Reveal Answer

Reveal Answer requires confirmation and is irreversible for the current day. It adds
missing words from an optimal solution in the rust `revealed` style without removing or
restyling the player's path. Revealed words do not change the player's submitted-word
score.

`SteinerSolver.reconstructOptimalTreeK3()` is intentionally specific to three targets.
It must not be treated as a general reconstruction algorithm for larger terminal sets.

## Board rendering

The D3 simulation briefly places a newly added node, then pins settled nodes so the web
does not continually move. `GraphView.beginBatch()` and `endBatch()` let reveal and
saved-state replay settle groups of nodes together. A bounds force keeps nodes visible,
and bubble sizes step down after the established node-count thresholds.

The live board and tutorial use separate SVG definition prefixes (`ww` and `tut`) so
their gradients and filters cannot collide.

## Tutorial and loading

The nine-step tutorial is gated by the `ww-seen-instructions-v3` local-storage key and
advances only when the player chooses Next or Back. It uses the same bubble drawing
module as the live board.

While the word graph and daily puzzle load, the board shows three placeholder bubbles.
The word input, Add button, and Reveal Answer control remain disabled until
`startPuzzle()` successfully initializes the puzzle.

## Word graph maintenance

`data/words.json` was built from five-letter lowercase dictionary words, filtered and
manually reviewed, then reduced to its largest connected component. The exact filtering
rules are documented in `tools/build_word_graph.py`.

Do not patch `data/words.json` by hand. Removing a word can disconnect other words, so
any word-list change requires running the rebuild utility and regenerating the entire
component and adjacency data.
