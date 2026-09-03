/**
 * app.js — orchestrates Word Web: loads the word graph, generates the
 * day's puzzle, validates typed word submissions, persists progress so a
 * closed tab resumes where it left off, and hands off to
 * RMLP.renderShareCard on completion (solved or revealed).
 *
 * There's no list of valid next words shown — the player types a candidate
 * and it's checked against two independent rules: is it a real word in our
 * graph, and is it exactly one letter from something already in the web.
 * A submission can satisfy both and still connect to more than one existing
 * web word at once (if it happens to be adjacent to several) — all of those
 * edges are made, which is also how two separate branches of the web end
 * up merging into one. That's structural bookkeeping (edgeSet, union-find),
 * not the score.
 *
 * Two benchmarks now, not one: perfectWords (the true Steiner-tree minimum
 * from the solver) and parWords (perfectWords + PAR_BONUS, a deliberately
 * generous placeholder target — a rough attainable goal, not a validated
 * average, until real completions exist to calibrate against). The score
 * itself is just submittedWords.length. No single verdict chip anymore —
 * the three numbers (Perfect / Par / Words) speak for themselves, and the
 * emotional framing lives in the share card's wording instead.
 *
 * No undo — once a connection is made it's committed. Revealing the answer
 * is a separate terminal state from solving, never adds to the player's
 * own word count, and only ever adds bubbles to the board (see
 * revealAnswer) — nothing already there is touched or removed.
 */
(function () {
  'use strict';

  var K = 3;
  var PAR_MIN = 5;
  var PAR_MAX = 8;
  var PAR_BONUS = 3; // parWords = perfectWords + PAR_BONUS -- crude placeholder, revisit once real completions exist
  var GAME_URL = 'https://blendletan.github.io/WordWeb/';
  var STORAGE_KEY = 'ww-daily-progress';
  var INSTRUCTIONS_SEEN_KEY = 'ww-seen-instructions-v3'; // bumped: tutorial content is new

  // Daily puzzle: deterministic per the player's local calendar date, so
  // everyone who opens the game on the same day gets the same puzzle —
  // same approach Wordle uses (local date, not a fixed UTC rollover), so
  // players in different timezones may roll over at different real-world
  // moments. That's expected, not a bug.
  //
  // Day numbering counts from this constant. Move it if you want to
  // renumber (e.g. back-date to when the game actually first went live).
  var EPOCH_DATE = { year: 2026, month: 8, day: 21 }; // Day #1

  function dateKey(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function dateKeyToUTC(key) {
    var y = Math.floor(key / 10000), m = Math.floor((key % 10000) / 100), day = key % 100;
    return Date.UTC(y, m - 1, day);
  }
  function todayInfo() {
    var key = dateKey(new Date());
    var epochKey = EPOCH_DATE.year * 10000 + EPOCH_DATE.month * 100 + EPOCH_DATE.day;
    var dayNumber = Math.round((dateKeyToUTC(key) - dateKeyToUTC(epochKey)) / 86400000) + 1;
    return { seed: key, dayNumber: Math.max(1, dayNumber) };
  }

  var els = {
    perfectValue: document.getElementById('perfect-value'),
    parValue: document.getElementById('par-value'),
    wordsValue: document.getElementById('words-value'),
    statsRow: document.getElementById('stats-row'),
    revealBtn: document.getElementById('reveal-btn'),
    howToPlayBtn: document.getElementById('how-to-play-btn'),
    wordForm: document.getElementById('word-form'),
    wordInput: document.getElementById('word-input'),
    wordSubmitBtn: document.getElementById('word-submit-btn'),
    entryFeedback: document.getElementById('entry-feedback'),
    modal: document.getElementById('how-to-play-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    revealConfirmModal: document.getElementById('reveal-confirm-modal'),
    revealConfirmCloseBtn: document.getElementById('reveal-confirm-close-btn'),
    revealCancelBtn: document.getElementById('reveal-cancel-btn'),
    revealConfirmBtn: document.getElementById('reveal-confirm-btn'),
    sharePanel: document.getElementById('share-panel'),
    shareCanvasWrap: document.getElementById('share-canvas-wrap'),
    shareCopyImageBtn: document.getElementById('share-copy-image-btn'),
    shareCopyTextBtn: document.getElementById('share-copy-text-btn'),
    shareDownloadBtn: document.getElementById('share-download-btn'),
    shareStatus: document.getElementById('share-status'),
    boardStatus: document.getElementById('board-status'),
    boardLoading: document.getElementById('board-loading'),
    graphSvg: document.getElementById('graph-svg'),
    dayLabel: document.getElementById('day-label')
  };

  var graphView = new GraphView('#graph-svg', { width: 720, height: 480 });

  var graph = null;
  var puzzle = null;
  var dayNumber = null;
  var perfectWords = null;
  var parWords = null;
  var webIndices = new Set();
  var edgeSet = new Set();
  var unionParent = new Map();
  var solved = false;
  var revealed = false;
  var submittedWords = [];
  var revealedWords = [];

  function find(x) {
    while (unionParent.get(x) !== x) x = unionParent.get(x);
    return x;
  }
  function union(a, b) {
    var ra = find(a), rb = find(b);
    if (ra !== rb) unionParent.set(ra, rb);
  }
  function edgeKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        dayNumber: dayNumber,
        submittedWords: submittedWords,
        revealedWords: revealedWords,
        status: revealed ? 'revealed' : (solved ? 'solved' : 'in-progress')
      }));
    } catch (e) { /* localStorage unavailable (private browsing etc.) — progress just won't resume */ }
  }

  function loadPersistedState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * One representative already-placed web word per *distinct connected
   * component* that idx is one letter from — not one per adjacent word.
   * See the README for why (average word degree ~6 means a candidate is
   * often adjacent to two words already in the same merged branch; one
   * edge per component is sufficient and never wastes a connection).
   */
  function findAttachPoints(idx) {
    var attachByComponent = new Map();
    webIndices.forEach(function (w) {
      if (graph.isAdjacent(idx, w)) {
        var root = find(w);
        if (!attachByComponent.has(root)) attachByComponent.set(root, w);
      }
    });
    return Array.from(attachByComponent.values());
  }

  function commitNewWord(idx, word, attachTo, isRevealed) {
    webIndices.add(idx);
    unionParent.set(idx, idx);
    attachTo.forEach(function (parentIdx, i) {
      var key = edgeKey(idx, parentIdx);
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      if (i === 0) {
        graphView.addNode(idx, word, { isTarget: false, parentId: parentIdx, revealed: !!isRevealed });
      } else {
        graphView.addLinkBetweenExisting(idx, parentIdx);
      }
      union(idx, parentIdx);
    });
  }

  function updateDayLabel() {
    if (!dayNumber) { els.dayLabel.textContent = ''; return; }
    var suffix = revealed ? ' \u00b7 Revealed' : (solved ? ' \u00b7 Solved' : '');
    els.dayLabel.textContent = 'Day #' + dayNumber + suffix;
  }

  function loadDailyPuzzle() {
    var info = todayInfo();
    var result = PuzzleGenerator.generate(graph, { k: K, minPar: PAR_MIN, maxPar: PAR_MAX, maxAttempts: 3000, seed: info.seed });
    startPuzzle(result, info.dayNumber);
    if (!result) return;

    var saved = loadPersistedState();
    if (!saved || saved.dayNumber !== info.dayNumber) return;

    // Replaying a saved session adds several nodes back-to-back with no
    // render in between — batch them so they settle together instead of
    // each one pinning the last before it ever gets to spread out.
    var hasWordsToReplay = (saved.submittedWords && saved.submittedWords.length > 0) ||
      (saved.status === 'revealed' && saved.revealedWords && saved.revealedWords.length > 0);
    if (hasWordsToReplay) graphView.beginBatch();

    (saved.submittedWords || []).forEach(function (idx) {
      var attach = findAttachPoints(idx);
      if (attach.length > 0) {
        commitNewWord(idx, graph.wordAt(idx), attach, false);
        submittedWords.push(idx);
      }
    });
    updateStats();

    if (saved.status === 'revealed') {
      (saved.revealedWords || []).forEach(function (idx) {
        var attach = findAttachPoints(idx);
        if (attach.length > 0) {
          commitNewWord(idx, graph.wordAt(idx), attach, true);
          revealedWords.push(idx);
        }
      });
      revealed = true;
      els.wordInput.disabled = true;
      els.wordSubmitBtn.disabled = true;
      els.revealBtn.disabled = true;
      els.boardStatus.textContent = 'Answer revealed.';
      updateDayLabel();
      updateStats();
      showSharePanel();
    } else {
      checkSolved();
    }

    if (hasWordsToReplay) graphView.endBatch();
  }

  function startPuzzle(result, dayNum) {
    els.boardLoading.hidden = true;
    els.graphSvg.hidden = false;
    if (!result) {
      els.boardStatus.textContent = 'Could not generate a puzzle — try reloading the page.';
      return;
    }
    puzzle = result;
    dayNumber = dayNum;
    perfectWords = puzzle.par - (K - 1); // steiner-tree edges -> minimum extra words
    parWords = perfectWords + PAR_BONUS;
    webIndices = new Set();
    edgeSet = new Set();
    unionParent = new Map();
    solved = false;
    revealed = false;
    submittedWords = [];
    revealedWords = [];

    graphView.reset();
    els.sharePanel.hidden = true;
    els.shareStatus.textContent = '';
    els.boardStatus.textContent = '';
    els.wordInput.disabled = false;
    els.wordSubmitBtn.disabled = false;
    els.wordInput.value = '';
    els.revealBtn.disabled = false;
    els.statsRow.hidden = false;
    showFeedback('', null);
    updateDayLabel();

    puzzle.targetIndices.forEach(function (idx) {
      webIndices.add(idx);
      unionParent.set(idx, idx);
      graphView.addNode(idx, graph.wordAt(idx), { isTarget: true });
    });

    updateStats();
    els.wordInput.focus();
  }

  function showFeedback(message, kind) {
    els.entryFeedback.textContent = message;
    els.entryFeedback.classList.toggle('is-error', kind === 'error');
    els.entryFeedback.classList.toggle('is-success', kind === 'success');
  }

  function evaluateSubmission(raw) {
    var word = raw.trim().toLowerCase();
    if (word.length === 0) return null;
    if (word.length !== 5) {
      return { ok: false, message: 'Words need to be exactly 5 letters.' };
    }
    if (!/^[a-z]+$/.test(word)) {
      return { ok: false, message: 'Letters only, please.' };
    }
    var idx = graph.indexOf(word);
    if (idx === -1) {
      return { ok: false, message: word.toUpperCase() + " isn't in the dictionary we're using." };
    }
    if (webIndices.has(idx)) {
      return { ok: false, message: word.toUpperCase() + ' is already in your web.' };
    }
    var attachTo = findAttachPoints(idx);
    if (attachTo.length === 0) {
      return { ok: false, message: word.toUpperCase() + " is a real word, but it's not one letter from anything in your web yet." };
    }
    return { ok: true, index: idx, word: word, attachTo: attachTo };
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (solved || revealed) return;
    var result = evaluateSubmission(els.wordInput.value);
    if (!result) return;
    if (!result.ok) {
      showFeedback(result.message, 'error');
      return;
    }

    commitNewWord(result.index, result.word, result.attachTo, false);
    submittedWords.push(result.index);

    var bridged = result.attachTo.length > 1 ? ' (bridging ' + result.attachTo.length + ' branches!)' : '';
    showFeedback(result.word.toUpperCase() + ' added.' + bridged, 'success');
    els.wordInput.value = '';
    els.wordInput.focus();

    updateStats();
    checkSolved();
    persistState();
  }

  function updateStats() {
    els.perfectValue.textContent = perfectWords;
    els.parValue.textContent = parWords;
    els.wordsValue.textContent = submittedWords.length;
  }

  function checkSolved() {
    if (revealed || solved) return;
    var targets = puzzle.targetIndices;
    var root0 = find(targets[0]);
    var allConnected = targets.every(function (t) { return find(t) === root0; });
    if (allConnected) {
      solved = true;
      graphView.markSolved();
      els.wordInput.disabled = true;
      els.wordSubmitBtn.disabled = true;
      els.revealBtn.disabled = true;
      if (submittedWords.length === perfectWords) {
        els.boardStatus.textContent = 'Perfect! All three words are connected.';
        updateDayLabel();
        showSharePanel();
    } else {
      revealOptimalAnswerAfterSolve();
    }
  }
}

function revealOptimalAnswerAfterSolve() {
  addOptimalAnswerToBoard();

  els.boardStatus.textContent =
    'Solved! The perfect solution is shown in rust.';

  updateDayLabel();
  updateStats();
  showSharePanel();
  persistState();
}



function addOptimalAnswerToBoard() {
  var treeNodes = SteinerSolver.reconstructOptimalTreeK3(
    graph.adjacency,
    puzzle.targetIndices
  );

  var remaining = treeNodes.filter(function (idx) {
    return !webIndices.has(idx);
  });

  var batching = remaining.length > 0;
  if (batching) graphView.beginBatch();

  var guard = 0;

  while (remaining.length && guard++ < 1000) {
    var progressed = false;

    for (var i = 0; i < remaining.length; i++) {
      var idx = remaining[i];
      var attach = findAttachPoints(idx);

      if (attach.length > 0) {
        commitNewWord(idx, graph.wordAt(idx), attach, true);
        revealedWords.push(idx);
        remaining.splice(i, 1);
        progressed = true;
        break;
      }
    }

    if (!progressed) break;
  }

  // The player's web may already be one connected component, so the normal
  // attachment rule above can omit edges needed to make the solver's chosen
  // optimal solution visually obvious.  Draw a spanning tree using only the
  // nodes in that optimal solution.
  var optimalSet = new Set(treeNodes);
  var visited = new Set();
  var queue = [puzzle.targetIndices[0]];
  visited.add(puzzle.targetIndices[0]);

  while (queue.length) {
    var u = queue.shift();
    var neighbours = graph.adjacency[u];

    for (var j = 0; j < neighbours.length; j++) {
      var v = neighbours[j];

      if (!optimalSet.has(v) || visited.has(v)) continue;

      visited.add(v);
      queue.push(v);

      var key = edgeKey(u, v);

      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        graphView.addLinkBetweenExisting(u, v);
        union(u, v);
      }
    }
  }

  if (batching) graphView.endBatch();
}


  /**
   * Adds every word from the optimal solution the player hadn't already
   * found, styled distinctly. Nothing already on the board is removed. A
   * word needed by the optimal tree that bridges more than one existing
   * branch attaches to all of them, same as live play.
   */
  function revealAnswer() {
    if (solved || revealed) return;
    addOptimalAnswerToBoard();

    revealed = true;

    els.wordInput.disabled = true;
    els.wordSubmitBtn.disabled = true;
    els.revealBtn.disabled = true;
    els.boardStatus.textContent = 'Answer revealed.';

    updateDayLabel();
    updateStats();
    showSharePanel();
    persistState();
  }

  function showSharePanel() {
    var title = 'Word Web #' + dayNumber;
    var wordsAdded = submittedWords.length;
    var stat, cells, accent;

    if (revealed) {
      stat = 'This one beat me!';
      cells = [];
      accent = '#A8501B';
    } else {
      var gold = Math.min(wordsAdded, perfectWords);
      var teal = Math.max(0, Math.min(wordsAdded, parWords) - perfectWords);
      var over = Math.max(0, wordsAdded - parWords);
      cells = [];
      var i;
      for (i = 0; i < gold; i++) cells.push('gold');
      for (i = 0; i < teal; i++) cells.push('teal');
      for (i = 0; i < over; i++) cells.push('red');

      if (wordsAdded <= perfectWords) stat = wordsAdded + ' words \u00b7 Perfect score';
      else if (wordsAdded <= parWords) stat = wordsAdded + ' words \u00b7 beat par by ' + (parWords - wordsAdded);
      else stat = wordsAdded + ' words \u00b7 +' + over + ' over par';
      accent = null;
    }

function trackShare(action) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({
      path: 'share-' + action,
      title: 'Word Web share: ' + action,
      event: true
    });
  }
}


    var canvas = RMLP.renderShareCard({ title: title, stat: stat, cells: cells, url: GAME_URL, accent: accent });
    els.shareCanvasWrap.innerHTML = '';
    els.shareCanvasWrap.appendChild(canvas);
    els.sharePanel.hidden = false;

    els.shareCopyImageBtn.onclick = async function () {
        trackShare('copy-image');
      try {
        await RMLP.copyShareCardImage(canvas);
        els.shareStatus.textContent = 'Image copied to clipboard.';
      } catch (e) {
        els.shareStatus.textContent = 'Could not copy image in this browser — try Download instead.';
      }
    };
    els.shareCopyTextBtn.onclick = async function () {
        trackShare('copy-text');
      var text = RMLP.shareCardText({ title: title, stat: stat, cells: cells, url: GAME_URL });
      try {
        await navigator.clipboard.writeText(text);
        els.shareStatus.textContent = 'Text copied to clipboard.';
      } catch (e) {
        els.shareStatus.textContent = text;
      }
    };
    els.shareDownloadBtn.onclick = function () {
        trackShare('download');
      RMLP.downloadShareCard(canvas, 'word-web.png');
    };
  }

  function openTutorial() {
    Tutorial.reset();
    els.modal.hidden = false;
  }

  function wireStaticUI() {
    els.howToPlayBtn.addEventListener('click', openTutorial);
    els.closeModalBtn.addEventListener('click', function () { els.modal.hidden = true; });
    els.modal.addEventListener('click', function (e) { if (e.target === els.modal) els.modal.hidden = true; });
    els.wordForm.addEventListener('submit', handleSubmit);

    els.revealBtn.addEventListener('click', function () { els.revealConfirmModal.hidden = false; });
    els.revealConfirmCloseBtn.addEventListener('click', function () { els.revealConfirmModal.hidden = true; });
    els.revealCancelBtn.addEventListener('click', function () { els.revealConfirmModal.hidden = true; });
    els.revealConfirmBtn.addEventListener('click', function () { els.revealConfirmModal.hidden = true; revealAnswer(); });
    els.revealConfirmModal.addEventListener('click', function (e) { if (e.target === els.revealConfirmModal) els.revealConfirmModal.hidden = true; });
  }

  async function init() {
    wireStaticUI();
    els.boardStatus.textContent = 'Loading today\u2019s puzzle\u2026';
    graph = await WordGraph.load('data/words.json');
    loadDailyPuzzle();

    if (!localStorage.getItem(INSTRUCTIONS_SEEN_KEY)) {
      openTutorial();
      try { localStorage.setItem(INSTRUCTIONS_SEEN_KEY, '1'); } catch (e) {}
    }
  }

  init();
})();
