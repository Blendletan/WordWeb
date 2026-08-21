/**
 * app.js — orchestrates Word Web: loads the word graph, generates a puzzle,
 * wires the picker panel and graph view together, tracks score, and hands
 * off to RMLP.renderShareCard on completion.
 *
 * Game state is deliberately simple: a set of node indices in the web, a
 * union-find over them (to detect when all target words are connected),
 * and a running count of connections made. No undo — once a connection is
 * made it's committed, matching the golf-style par scoring.
 */
(function () {
  'use strict';

  const K = 3;
  const PAR_MIN = 5;
  const PAR_MAX = 8;

  const els = {
    parValue: document.getElementById('par-value'),
    connectionsValue: document.getElementById('connections-value'),
    scoreValue: document.getElementById('score-value'),
    shareBtn: document.getElementById('share-btn'),
    newPuzzleBtn: document.getElementById('new-puzzle-btn'),
    howToPlayBtn: document.getElementById('how-to-play-btn'),
    pickerHint: document.getElementById('picker-hint'),
    pickerChips: document.getElementById('picker-chips'),
    modal: document.getElementById('how-to-play-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    modalGotItBtn: document.getElementById('modal-got-it-btn'),
    sharePanel: document.getElementById('share-panel'),
    shareCanvasWrap: document.getElementById('share-canvas-wrap'),
    shareCopyImageBtn: document.getElementById('share-copy-image-btn'),
    shareCopyTextBtn: document.getElementById('share-copy-text-btn'),
    shareDownloadBtn: document.getElementById('share-download-btn'),
    shareStatus: document.getElementById('share-status'),
    boardStatus: document.getElementById('board-status')
  };

  const graphView = new GraphView('#graph-svg', { width: 640, height: 420, nodeRadius: 26 });

  let graph = null;
  let puzzle = null;
  let webIndices = new Set();
  let edgeSet = new Set();
  let unionParent = new Map();
  let connections = 0;
  let selectedIndex = null;
  let solved = false;

  function find(x) {
    while (unionParent.get(x) !== x) x = unionParent.get(x);
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) unionParent.set(ra, rb);
  }
  function edgeKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }

  function newPuzzle() {
    const result = PuzzleGenerator.generate(graph, { k: K, minPar: PAR_MIN, maxPar: PAR_MAX, maxAttempts: 3000 });
    if (!result) {
      els.boardStatus.textContent = 'Could not generate a puzzle — try New puzzle again.';
      return;
    }
    puzzle = result;
    webIndices = new Set();
    edgeSet = new Set();
    unionParent = new Map();
    connections = 0;
    selectedIndex = null;
    solved = false;

    graphView.reset();
    els.sharePanel.hidden = true;
    els.shareStatus.textContent = '';
    els.boardStatus.textContent = '';

    puzzle.targetIndices.forEach(function (idx) {
      webIndices.add(idx);
      unionParent.set(idx, idx);
      graphView.addNode(idx, graph.wordAt(idx), { isTarget: true });
    });

    updateStats();
    renderPicker();
  }

  function candidatesFor(idx) {
    const nbrs = graph.neighborsOf(idx);
    return nbrs.filter(function (n) { return !edgeSet.has(edgeKey(idx, n)); });
  }

  function selectNode(idx) {
    selectedIndex = idx;
    graphView.setSelected(idx);
    renderPicker();
  }

  function renderPicker() {
    els.pickerChips.innerHTML = '';
    if (selectedIndex == null) {
      els.pickerHint.textContent = 'Tap a bubble to see what connects to it.';
      return;
    }
    const word = graph.wordAt(selectedIndex);
    const candidates = candidatesFor(selectedIndex);
    if (solved) {
      els.pickerHint.textContent = 'Web complete — ' + word.toUpperCase() + ' is connected.';
      return;
    }
    if (candidates.length === 0) {
      els.pickerHint.textContent = 'No new connections from ' + word.toUpperCase() + ' — try another bubble.';
      return;
    }
    els.pickerHint.textContent = 'Words one letter from ' + word.toUpperCase() + ':';
    candidates
      .slice()
      .sort(function (a, b) { return graph.wordAt(a).localeCompare(graph.wordAt(b)); })
      .forEach(function (candidateIdx) {
        const btn = document.createElement('button');
        btn.className = 'ww-chip';
        btn.textContent = graph.wordAt(candidateIdx);
        btn.addEventListener('click', function () { addConnection(selectedIndex, candidateIdx); });
        els.pickerChips.appendChild(btn);
      });
  }

  function addConnection(fromIdx, toIdx) {
    if (solved) return;
    const key = edgeKey(fromIdx, toIdx);
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    connections++;

    const isNewNode = !webIndices.has(toIdx);
    if (isNewNode) {
      webIndices.add(toIdx);
      unionParent.set(toIdx, toIdx);
      graphView.addNode(toIdx, graph.wordAt(toIdx), {
        isTarget: puzzle.targetIndices.indexOf(toIdx) !== -1,
        parentId: fromIdx
      });
    } else {
      graphView.addLinkBetweenExisting(fromIdx, toIdx);
    }
    union(fromIdx, toIdx);

    selectNode(toIdx);
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
      renderPicker();
      showSharePanel();
    }
  }

  function showSharePanel() {
    const over = Math.max(0, connections - puzzle.par);
    const cells = [];
    for (let i = 0; i < puzzle.par; i++) cells.push('gold');
    for (let i = 0; i < over; i++) cells.push('red');

    const title = 'Word Web';
    const stat = connections + ' connections \u00b7 ' + (over === 0 ? 'at par' : '+' + over + ' over par');

    const canvas = RMLP.renderShareCard({ title: title, stat: stat, cells: cells });
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
      const text = RMLP.shareCardText({ title: title, stat: stat, cells: cells });
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
    els.newPuzzleBtn.addEventListener('click', newPuzzle);
    els.howToPlayBtn.addEventListener('click', function () { els.modal.hidden = false; });
    els.closeModalBtn.addEventListener('click', function () { els.modal.hidden = true; });
    els.modalGotItBtn.addEventListener('click', function () { els.modal.hidden = true; });
    els.modal.addEventListener('click', function (e) { if (e.target === els.modal) els.modal.hidden = true; });
  }

  async function init() {
    wireStaticUI();
    els.boardStatus.textContent = 'Loading word graph\u2026';
    graph = await WordGraph.load('data/words.json');
    graphView.onNodeClick = selectNode;
    newPuzzle();

    // First-time visitors see the instructions automatically.
    if (!localStorage.getItem('ww-seen-instructions')) {
      els.modal.hidden = false;
      try { localStorage.setItem('ww-seen-instructions', '1'); } catch (e) {}
    }
  }

  init();
})();
