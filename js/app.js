/**
 * app.js — orchestrates Word Web: loads the word graph, generates a puzzle,
 * validates typed word submissions against the graph, and hands off to
 * RMLP.renderShareCard on completion.
 *
 * There's no list of valid next words shown — the player types a candidate
 * and it's checked against two independent rules: is it a real word in our
 * graph, and is it exactly one letter from something already in the web.
 * A submission can satisfy both and still connect to more than one existing
 * web word at once (if it happens to be adjacent to several) — all of those
 * connections are made, which is also how two separate branches of the web
 * end up merging into one.
 *
 * Game state is a set of node indices in the web, a union-find over them
 * (to detect when all target words are connected), and a running count of
 * connections made. No undo — once a connection is made it's committed,
 * matching the golf-style par scoring.
 */
(function () {
  'use strict';

  const K = 3;
  const PAR_MIN = 5;
  const PAR_MAX = 8;
  const GAME_URL = 'https://blendletan.github.io/WordWeb/';

  // Daily puzzle: deterministic per the player's local calendar date, so
  // everyone who opens the game on the same day gets the same puzzle —
  // same approach Wordle uses (local date, not a fixed UTC rollover), so
  // players in different timezones may roll over at different real-world
  // moments. That's expected, not a bug.
  //
  // Day numbering counts from this constant. Move it if you want to
  // renumber (e.g. back-date to when the game actually first went live).
  const EPOCH_DATE = { year: 2026, month: 8, day: 21 }; // Day #1

  function dateKey(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function dateKeyToUTC(key) {
    const y = Math.floor(key / 10000), m = Math.floor((key % 10000) / 100), day = key % 100;
    return Date.UTC(y, m - 1, day);
  }
  function todayInfo() {
    const key = dateKey(new Date());
    const epochKey = EPOCH_DATE.year * 10000 + EPOCH_DATE.month * 100 + EPOCH_DATE.day;
    const dayNumber = Math.round((dateKeyToUTC(key) - dateKeyToUTC(epochKey)) / 86400000) + 1;
    return { seed: key, dayNumber: Math.max(1, dayNumber) };
  }

  const els = {
    parValue: document.getElementById('par-value'),
    connectionsValue: document.getElementById('connections-value'),
    scoreValue: document.getElementById('score-value'),
    shareBtn: document.getElementById('share-btn'),
    newPuzzleBtn: document.getElementById('new-puzzle-btn'),
    howToPlayBtn: document.getElementById('how-to-play-btn'),
    wordForm: document.getElementById('word-form'),
    wordInput: document.getElementById('word-input'),
    wordSubmitBtn: document.getElementById('word-submit-btn'),
    entryFeedback: document.getElementById('entry-feedback'),
    modal: document.getElementById('how-to-play-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    modalGotItBtn: document.getElementById('modal-got-it-btn'),
    sharePanel: document.getElementById('share-panel'),
    shareCanvasWrap: document.getElementById('share-canvas-wrap'),
    shareCopyImageBtn: document.getElementById('share-copy-image-btn'),
    shareCopyTextBtn: document.getElementById('share-copy-text-btn'),
    shareDownloadBtn: document.getElementById('share-download-btn'),
    shareStatus: document.getElementById('share-status'),
    boardStatus: document.getElementById('board-status'),
    subtitle: document.getElementById('ww-subtitle')
  };

  const graphView = new GraphView('#graph-svg', { width: 640, height: 420, nodeRadius: 32 });

  let graph = null;
  let puzzle = null;
  let webIndices = new Set();
  let edgeSet = new Set();
  let unionParent = new Map();
  let connections = 0;
  let solved = false;
  let isDaily = true;
  let dayNumber = null;

  function find(x) {
    while (unionParent.get(x) !== x) x = unionParent.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) unionParent.set(ra, rb);
  }
  function edgeKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }

  function loadDailyPuzzle() {
    const info = todayInfo();
    const result = PuzzleGenerator.generate(graph, { k: K, minPar: PAR_MIN, maxPar: PAR_MAX, maxAttempts: 3000, seed: info.seed });
    startPuzzle(result, { daily: true, dayNumber: info.dayNumber });
  }

  function loadPracticePuzzle() {
    const result = PuzzleGenerator.generate(graph, { k: K, minPar: PAR_MIN, maxPar: PAR_MAX, maxAttempts: 3000 });
    startPuzzle(result, { daily: false });
  }

  function startPuzzle(result, meta) {
    if (!result) {
      els.boardStatus.textContent = 'Could not generate a puzzle — try again.';
      return;
    }
    puzzle = result;
    isDaily = meta.daily;
    dayNumber = meta.dayNumber || null;
    webIndices = new Set();
    edgeSet = new Set();
    unionParent = new Map();
    connections = 0;
    solved = false;

    graphView.reset();
    els.sharePanel.hidden = true;
    els.shareStatus.textContent = '';
    els.boardStatus.textContent = '';
    els.wordInput.disabled = false;
    els.wordSubmitBtn.disabled = false;
    els.wordInput.value = '';
    showFeedback('', null);
    els.subtitle.textContent = isDaily
      ? 'Day #' + dayNumber + ' — connect the words, one letter at a time.'
      : 'Practice puzzle — connect the words, one letter at a time.';

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

  /**
   * Validates a typed submission against the two independent rules and,
   * on success, returns one representative already-placed web word per
   * *distinct connected component* it's one letter from — not one per
   * adjacent word. A candidate is often adjacent to more than one word
   * already in the same already-merged branch (average word degree is
   * ~6), and drawing an edge for each of those would be a wasted,
   * redundant connection that makes par unreachable through no fault of
   * the player's word choice. One edge per component is both sufficient
   * (still merges every branch it touches) and never wasteful.
   */
  function evaluateSubmission(raw) {
    const word = raw.trim().toLowerCase();
    if (word.length === 0) return null;
    if (word.length !== 5) {
      return { ok: false, message: 'Words need to be exactly 5 letters.' };
    }
    if (!/^[a-z]+$/.test(word)) {
      return { ok: false, message: 'Letters only, please.' };
    }
    const idx = graph.indexOf(word);
    if (idx === -1) {
      return { ok: false, message: word.toUpperCase() + " isn't in the dictionary we're using." };
    }
    if (webIndices.has(idx)) {
      return { ok: false, message: word.toUpperCase() + ' is already in your web.' };
    }
    const attachByComponent = new Map(); // component root -> one representative member
    webIndices.forEach(function (w) {
      if (graph.isAdjacent(idx, w)) {
        const root = find(w);
        if (!attachByComponent.has(root)) attachByComponent.set(root, w);
      }
    });
    if (attachByComponent.size === 0) {
      return { ok: false, message: word.toUpperCase() + " is a real word, but it's not one letter from anything in your web yet." };
    }
    return { ok: true, index: idx, word: word, attachTo: Array.from(attachByComponent.values()) };
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (solved) return;
    const result = evaluateSubmission(els.wordInput.value);
    if (!result) return;
    if (!result.ok) {
      showFeedback(result.message, 'error');
      return;
    }

    webIndices.add(result.index);
    unionParent.set(result.index, result.index);

    result.attachTo.forEach(function (parentIdx, i) {
      const key = edgeKey(result.index, parentIdx);
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      connections++;
      if (i === 0) {
        graphView.addNode(result.index, result.word, { isTarget: false, parentId: parentIdx });
      } else {
        graphView.addLinkBetweenExisting(result.index, parentIdx);
      }
      union(result.index, parentIdx);
    });

    const bridged = result.attachTo.length > 1 ? ' (bridging ' + result.attachTo.length + ' branches!)' : '';
    showFeedback(result.word.toUpperCase() + ' added.' + bridged, 'success');
    els.wordInput.value = '';
    els.wordInput.focus();

    updateStats();
    checkSolved();
  }

  function updateStats() {
    els.parValue.textContent = puzzle.par;
    els.connectionsValue.textContent = connections;
    const over = connections - puzzle.par;
    els.scoreValue.textContent = over <= 0 ? 'E' : '+' + over;
    els.scoreValue.classList.toggle('ww-over', over > 0);
    els.scoreValue.classList.toggle('ww-at-par', over <= 0 && connections > 0);
  }

  function checkSolved() {
    const targets = puzzle.targetIndices;
    const root0 = find(targets[0]);
    const allConnected = targets.every(function (t) { return find(t) === root0; });
    if (allConnected && !solved) {
      solved = true;
      graphView.markSolved();
      els.boardStatus.textContent = 'Solved! All three words are connected.';
      els.wordInput.disabled = true;
      els.wordSubmitBtn.disabled = true;
      showSharePanel();
    }
  }

  function showSharePanel() {
    const over = Math.max(0, connections - puzzle.par);
    const cells = [];
    for (let i = 0; i < puzzle.par; i++) cells.push('gold');
    for (let i = 0; i < over; i++) cells.push('red');

    const title = isDaily ? 'Word Web #' + dayNumber : 'Word Web — Practice';
    const stat = connections + ' connections \u00b7 ' + (over === 0 ? 'at par' : '+' + over + ' over par');

    const canvas = RMLP.renderShareCard({ title: title, stat: stat, cells: cells, url: GAME_URL });
    els.shareCanvasWrap.innerHTML = '';
    els.shareCanvasWrap.appendChild(canvas);
    els.sharePanel.hidden = false;

    els.shareCopyImageBtn.onclick = async function () {
      try {
        await RMLP.copyShareCardImage(canvas);
        els.shareStatus.textContent = 'Image copied to clipboard.';
      } catch (e) {
        els.shareStatus.textContent = 'Could not copy image in this browser — try Download instead.';
      }
    };
    els.shareCopyTextBtn.onclick = async function () {
      const text = RMLP.shareCardText({ title: title, stat: stat, cells: cells, url: GAME_URL });
      try {
        await navigator.clipboard.writeText(text);
        els.shareStatus.textContent = 'Text copied to clipboard.';
      } catch (e) {
        els.shareStatus.textContent = text;
      }
    };
    els.shareDownloadBtn.onclick = function () {
      RMLP.downloadShareCard(canvas, 'word-web.png');
    };
  }

  function wireStaticUI() {
    els.newPuzzleBtn.addEventListener('click', loadPracticePuzzle);
    els.howToPlayBtn.addEventListener('click', function () { els.modal.hidden = false; });
    els.closeModalBtn.addEventListener('click', function () { els.modal.hidden = true; });
    els.modalGotItBtn.addEventListener('click', function () { els.modal.hidden = true; els.wordInput.focus(); });
    els.modal.addEventListener('click', function (e) { if (e.target === els.modal) els.modal.hidden = true; });
    els.wordForm.addEventListener('submit', handleSubmit);
  }

  async function init() {
    wireStaticUI();
    els.boardStatus.textContent = 'Loading word graph\u2026';
    graph = await WordGraph.load('data/words.json');
    loadDailyPuzzle();

    // First-time visitors see the instructions automatically.
    if (!localStorage.getItem('ww-seen-instructions')) {
      els.modal.hidden = false;
      try { localStorage.setItem('ww-seen-instructions', '1'); } catch (e) {}
    }
  }

  init();
})();
