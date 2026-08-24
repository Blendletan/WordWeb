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
 * The score is words added — submittedWords.length — compared against
 * parWords (par re-expressed in words; see startPuzzle). Not an edge
 * count: puzzle.par from the Steiner solver is edges, and a single bridging
 * word can create two or three edges at once, which would make the score
 * jump unpredictably relative to what the player actually typed. Words
 * added is the number a player is actually watching climb by exactly 1
 * per submission, and it's the one printed on the tin ("Word Web" — a
 * word game). It also happens to always land on the identical final
 * over/under-par verdict as edges would at the moment of solving, since
 * the two differ by a fixed constant once the web is fully connected —
 * but the live, mid-game number only behaves predictably in words.
 *
 * No undo — once a connection is made it's committed, matching the
 * golf-style par scoring. Revealing the answer is a separate terminal
 * state from solving and never adds to the player's own word count —
 * it's scored and shared distinctly ("Revealed" / "This one beat me!").
 */
(function () {
  'use strict';

  const K = 3;
  const PAR_MIN = 5;
  const PAR_MAX = 8;
  const GAME_URL = 'https://blendletan.github.io/WordWeb/';
  const STORAGE_KEY = 'ww-daily-progress';
  const INSTRUCTIONS_SEEN_KEY = 'ww-seen-instructions-v2'; // bumped so returning players see the Reveal Answer note once

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
    wordsValue: document.getElementById('words-value'),
    scoreValue: document.getElementById('score-value'),
    revealBtn: document.getElementById('reveal-btn'),
    howToPlayBtn: document.getElementById('how-to-play-btn'),
    wordForm: document.getElementById('word-form'),
    wordInput: document.getElementById('word-input'),
    wordSubmitBtn: document.getElementById('word-submit-btn'),
    entryFeedback: document.getElementById('entry-feedback'),
    modal: document.getElementById('how-to-play-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    modalGotItBtn: document.getElementById('modal-got-it-btn'),
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
    subtitle: document.getElementById('ww-subtitle')
  };

  const graphView = new GraphView('#graph-svg', { width: 720, height: 480, nodeRadius: 32 });

  let graph = null;
  let puzzle = null;
  let dayNumber = null;
  let parWords = null;      // par expressed in words added, not raw Steiner-tree edges — see startPuzzle
  let webIndices = new Set();
  let edgeSet = new Set();
  let unionParent = new Map();
  let solved = false;
  let revealed = false;
  let submittedWords = [];  // ordered word indices the player typed — this IS the score, .length is words added
  let revealedWords = [];   // ordered word indices added via Reveal Answer

  function find(x) {
    while (unionParent.get(x) !== x) x = unionParent.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
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
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * One representative already-placed web word per *distinct connected
   * component* that idx is one letter from — not one per adjacent word.
   * A candidate is often adjacent to more than one word already in the
   * same already-merged branch (average word degree is ~6), and drawing
   * an edge for each of those would be a wasted, redundant connection
   * that makes par unreachable through no fault of the player's word
   * choice. One edge per component is both sufficient (still merges
   * every branch it touches) and never wasteful. Shared by live
   * submission, replay-on-load, and Reveal Answer.
   */
  function findAttachPoints(idx) {
    const attachByComponent = new Map();
    webIndices.forEach(function (w) {
      if (graph.isAdjacent(idx, w)) {
        const root = find(w);
        if (!attachByComponent.has(root)) attachByComponent.set(root, w);
      }
    });
    return Array.from(attachByComponent.values());
  }

  /**
   * Adds a word to the web and wires its edges. Shared by live
   * submission, replay-on-load, and Reveal Answer. Edge bookkeeping
   * (edgeSet, union-find) is purely structural — it decides where things
   * connect and when the puzzle is solved. The score itself is just
   * submittedWords.length; see the "Score naming" note in the README for
   * why that's the right unit and not an edge count.
   */
  function commitNewWord(idx, word, attachTo, isRevealed) {
    webIndices.add(idx);
    unionParent.set(idx, idx);
    attachTo.forEach(function (parentIdx, i) {
      const key = edgeKey(idx, parentIdx);
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

  function loadDailyPuzzle() {
    const info = todayInfo();
    const result = PuzzleGenerator.generate(graph, { k: K, minPar: PAR_MIN, maxPar: PAR_MAX, maxAttempts: 3000, seed: info.seed });
    startPuzzle(result, info.dayNumber);

    const saved = loadPersistedState();
    if (!saved || saved.dayNumber !== info.dayNumber) return; // no saved state, or it's from a previous day

    (saved.submittedWords || []).forEach(function (idx) {
      const attach = findAttachPoints(idx);
      if (attach.length > 0) {
        commitNewWord(idx, graph.wordAt(idx), attach, false);
        submittedWords.push(idx);
      }
    });
    updateStats();

    if (saved.status === 'revealed') {
      (saved.revealedWords || []).forEach(function (idx) {
        const attach = findAttachPoints(idx);
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
      updateStats();
      showSharePanel();
    } else {
      checkSolved(); // no-ops harmlessly if not actually all-connected yet
    }
  }

  function startPuzzle(result, dayNum) {
    if (!result) {
      els.boardStatus.textContent = 'Could not generate a puzzle — try again.';
      return;
    }
    puzzle = result;
    dayNumber = dayNum;
    // puzzle.par is edges in the optimal Steiner tree; a tree with that
    // many edges has (par + 1) nodes total, of which K are the starting
    // targets, so the minimum *words* needed is par - (K - 1).
    parWords = puzzle.par - (K - 1);
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
    showFeedback('', null);
    els.subtitle.textContent = 'Day #' + dayNumber + ' — connect the words, one letter at a time.';

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
    const attachTo = findAttachPoints(idx);
    if (attachTo.length === 0) {
      return { ok: false, message: word.toUpperCase() + " is a real word, but it's not one letter from anything in your web yet." };
    }
    return { ok: true, index: idx, word: word, attachTo: attachTo };
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (solved || revealed) return;
    const result = evaluateSubmission(els.wordInput.value);
    if (!result) return;
    if (!result.ok) {
      showFeedback(result.message, 'error');
      return;
    }

    commitNewWord(result.index, result.word, result.attachTo, false);
    submittedWords.push(result.index);

    const bridged = result.attachTo.length > 1 ? ' (bridging ' + result.attachTo.length + ' branches!)' : '';
    showFeedback(result.word.toUpperCase() + ' added.' + bridged, 'success');
    els.wordInput.value = '';
    els.wordInput.focus();

    updateStats();
    checkSolved();
    persistState();
  }

  function updateStats() {
    els.parValue.textContent = parWords;
    els.wordsValue.textContent = submittedWords.length;
    if (revealed) {
      els.scoreValue.textContent = 'REVEALED';
      els.scoreValue.classList.remove('ww-over', 'ww-at-par');
      els.scoreValue.classList.add('ww-revealed');
      return;
    }
    els.scoreValue.classList.remove('ww-revealed');
    const over = submittedWords.length - parWords;
    els.scoreValue.textContent = over <= 0 ? 'PERFECT' : '+' + over;
    els.scoreValue.classList.toggle('ww-over', over > 0);
    els.scoreValue.classList.toggle('ww-at-par', over <= 0 && submittedWords.length > 0);
  }

  function checkSolved() {
    if (revealed || solved) return;
    const targets = puzzle.targetIndices;
    const root0 = find(targets[0]);
    const allConnected = targets.every(function (t) { return find(t) === root0; });
    if (allConnected) {
      solved = true;
      graphView.markSolved();
      els.boardStatus.textContent = 'Solved! All three words are connected.';
      els.wordInput.disabled = true;
      els.wordSubmitBtn.disabled = true;
      els.revealBtn.disabled = true;
      showSharePanel();
    }
  }

  /**
   * Adds every word from the optimal solution the player hadn't already
   * found, styled distinctly (see .is-revealed in word-web.css) so it's
   * clear which bubbles were theirs and which they were missing. Nothing
   * already on the board is removed. A word needed by the optimal tree
   * that bridges more than one existing branch attaches to all of them,
   * same as live play.
   */
  function revealAnswer() {
    if (solved || revealed) return;
    const treeNodes = SteinerSolver.reconstructOptimalTreeK3(graph.adjacency, puzzle.targetIndices);
    const remaining = treeNodes.filter(function (idx) { return !webIndices.has(idx); });

    let guard = 0;
    while (remaining.length && guard++ < 1000) {
      let progressed = false;
      for (let i = 0; i < remaining.length; i++) {
        const idx = remaining[i];
        const attach = findAttachPoints(idx);
        if (attach.length > 0) {
          commitNewWord(idx, graph.wordAt(idx), attach, true);
          revealedWords.push(idx);
          remaining.splice(i, 1);
          progressed = true;
          break;
        }
      }
      if (!progressed) break; // shouldn't happen for a valid tree, but don't hang if it somehow does
    }

    revealed = true;
    els.wordInput.disabled = true;
    els.wordSubmitBtn.disabled = true;
    els.revealBtn.disabled = true;
    els.boardStatus.textContent = 'Answer revealed.';
    updateStats();
    showSharePanel();
    persistState();
  }

  function showSharePanel() {
    const title = 'Word Web #' + dayNumber;
    const wordsAdded = submittedWords.length;
    let stat, cells;

    if (revealed) {
      // Cells show how far the player's own play got before giving up —
      // gold for words they actually found, dull for the rest of par's
      // length — capped at par so a wild overshoot before giving up
      // doesn't read as more filled-in than "This one beat me!" implies.
      const foundCells = Math.min(wordsAdded, parWords);
      cells = [];
      for (let i = 0; i < foundCells; i++) cells.push('gold');
      for (let i = foundCells; i < parWords; i++) cells.push('invalid');
      stat = 'This one beat me!';
    } else {
      const over = Math.max(0, wordsAdded - parWords);
      cells = [];
      for (let i = 0; i < parWords; i++) cells.push('gold');
      for (let i = 0; i < over; i++) cells.push('red');
      stat = wordsAdded + ' words \u00b7 ' + (over === 0 ? 'Perfect score' : '+' + over + ' over par');
    }

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
    els.howToPlayBtn.addEventListener('click', function () { els.modal.hidden = false; });
    els.closeModalBtn.addEventListener('click', function () { els.modal.hidden = true; });
    els.modalGotItBtn.addEventListener('click', function () { els.modal.hidden = true; els.wordInput.focus(); });
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
    els.boardStatus.textContent = 'Loading word graph\u2026';
    graph = await WordGraph.load('data/words.json');
    loadDailyPuzzle();

    // First-time (or post-update) visitors see the instructions automatically.
    if (!localStorage.getItem(INSTRUCTIONS_SEEN_KEY)) {
      els.modal.hidden = false;
      try { localStorage.setItem(INSTRUCTIONS_SEEN_KEY, '1'); } catch (e) {}
    }
  }

  init();
})();
