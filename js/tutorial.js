/**
 * Tutorial — the nine-step onboarding slideshow, replacing the old static
 * rules list. Uses BASIS/PANEL/PAGED, a real graph-verified puzzle with a
 * genuine near-miss (CANES), not an invented example — see the project
 * notes for how it was found and why it demonstrates the no-undo scoring
 * mechanic honestly (a wrong turn is never a dead end, just one permanent
 * extra word).
 *
 * Draws bubbles and threads through BubbleTheme (bubble-theme.js), the
 * same module graph-view.js uses for the live board, with a distinct
 * 'tut' id prefix so its <defs> never collide with the live board's.
 * That shared drawing code is what keeps this from visually drifting away
 * from the real game — not a promise to keep two copies of the same
 * numbers in sync by hand.
 *
 * Click-to-advance, not a timer, since this only ever plays once per
 * player (gated by app.js's "seen it" flag) and shouldn't force a pace.
 */
(function () {
  'use strict';

  var NODES = {
    panel: { x: 50, y: 40, label: 'PANEL', kind: 'target' },
    paged: { x: 310, y: 50, label: 'PAGED', kind: 'target' },
    basis: { x: 130, y: 230, label: 'BASIS', kind: 'target' },
    pages: { x: 235, y: 55, label: 'PAGES', kind: 'normal' },
    panes: { x: 145, y: 55, label: 'PANES', kind: 'normal' },
    canes: { x: 215, y: 135, label: 'CANES', kind: 'normal' },
    banes: { x: 130, y: 150, label: 'BANES', kind: 'normal' },
    bases: { x: 55, y: 185, label: 'BASES', kind: 'normal' }
  };

  var EDGES = {
    'paged-pages': { a: 'paged', b: 'pages', bow: -1 },
    'pages-panes': { a: 'pages', b: 'panes', bow: -1 },
    'panel-panes': { a: 'panel', b: 'panes', bow: -1 },
    'panes-canes': { a: 'panes', b: 'canes', bow: 1 },
    'canes-banes': { a: 'canes', b: 'banes', bow: -1 },
    'banes-bases': { a: 'banes', b: 'bases', bow: -1 },
    'bases-basis': { a: 'bases', b: 'basis', bow: 1 }
  };
  var GHOST_EDGE = { a: 'panes', b: 'banes', bow: -1 };

  var base1 = ['panel', 'paged', 'basis'];
  var base2 = base1.concat(['pages']);
  var base3 = base2.concat(['panes']);
  var base4 = base3.concat(['canes', 'banes', 'bases']);
  var e1 = ['paged-pages'];
  var e2 = e1.concat(['pages-panes', 'panel-panes']);
  var e3 = e2.concat(['panes-canes', 'canes-banes', 'banes-bases', 'bases-basis']);

  var STEPS = [
    { nodes: base1, edges: [], words: 0, caption: "You start with three words. Not connected yet." },
    { nodes: base2, edges: e1, words: 1, caption: "Type a real word \u2014 one letter different from something already there." },
    { nodes: base2, edges: e1, words: 1, caption: "Every word costs you one. Words: 1." },
    { nodes: base3, edges: e2, words: 2, caption: "One word can bridge two branches at once. PANEL and PAGED, joined." },
    { nodes: base3, edges: e2, words: 2, caption: "Words: 2 \u00b7 Par: 7 \u00b7 Perfect: 4 \u2014 BASIS is still out there alone." },
    { nodes: base4, edges: e3, words: 5, caption: "A few more steps... solved! Words: 5." },
    { nodes: base4, edges: e3, words: 5, caption: "Beat par by 2. Getting Perfect is hard \u2014 that's a good result." },
    { nodes: base4, edges: e3, words: 5, wasted: ['canes'], ghost: true, caption: "Here's the optimal path \u2014 PANES connects straight to BANES. CANES wasn't needed." },
    { nodes: base4, edges: e3, words: 5, wasted: ['canes'], ghost: true, caption: "One word. That's the whole gap between this and Perfect." }
  ];

  var current = 0;
  var initialized = false;
  var closeHandler = null;
  var edgesEl, nodesEl, captionEl, wordsEl, dotsEl, prevBtn, nextBtn;

  function edgePathFor(edgeDef) {
    var a = NODES[edgeDef.a], b = NODES[edgeDef.b];
    return BubbleTheme.edgePath(a.x, a.y, b.x, b.y, edgeDef.bow);
  }

  function render() {
    var step = STEPS[current];

    var edgesHtml = '';
    step.edges.forEach(function (key) {
      edgesHtml += '<path d="' + edgePathFor(EDGES[key]) + '" fill="none" stroke="#8A7355" stroke-width="2" stroke-linecap="round"/>';
    });
    if (step.ghost) {
      edgesHtml += '<path d="' + edgePathFor(GHOST_EDGE) + '" fill="none" stroke="#8A7355" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 5" opacity="0.7"/>';
    }
    edgesEl.innerHTML = edgesHtml;

    var nodesHtml = '';
    step.nodes.forEach(function (key) {
      var n = NODES[key];
      var wasted = step.wasted && step.wasted.indexOf(key) !== -1;
      nodesHtml += BubbleTheme.bubbleMarkup({
        x: n.x, y: n.y, radius: 33, label: n.label,
        kind: wasted ? 'revealed' : n.kind,
        idPrefix: 'tut'
      });
    });
    nodesEl.innerHTML = nodesHtml;

    captionEl.textContent = step.caption;
    wordsEl.textContent = step.words;

    var dots = dotsEl.children;
    for (var i = 0; i < dots.length; i++) {
      var isCurrent = i === current;
      dots[i].style.background = isCurrent ? '#C1432B' : (i < current ? '#C9B896' : '#E4DCC9');
      dots[i].style.width = isCurrent ? '8px' : '6px';
      dots[i].style.height = isCurrent ? '8px' : '6px';
    }

    prevBtn.style.visibility = current === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = current === STEPS.length - 1 ? 'Let\u2019s play' : 'Next';
  }

  function goNext() {
    if (current < STEPS.length - 1) {
      current++;
      render();
    } else {
      if (closeHandler) closeHandler();
    }
  }

  function goPrev() {
    if (current > 0) {
      current--;
      render();
    }
  }

  function setup() {
    var svg = document.getElementById('tutorial-svg');
    svg.innerHTML = '<defs>' + BubbleTheme.defsMarkup('tut') + '</defs>' +
      '<g id="tutorial-edges"></g><g id="tutorial-nodes"></g>';

    edgesEl = document.getElementById('tutorial-edges');
    nodesEl = document.getElementById('tutorial-nodes');
    captionEl = document.getElementById('tutorial-caption');
    wordsEl = document.getElementById('tutorial-words');
    dotsEl = document.getElementById('tutorial-dots');
    prevBtn = document.getElementById('tutorial-prev-btn');
    nextBtn = document.getElementById('tutorial-next-btn');

    dotsEl.innerHTML = '';
    for (var d = 0; d < STEPS.length; d++) {
      var dot = document.createElement('div');
      dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#C9B896;';
      dotsEl.appendChild(dot);
    }

    prevBtn.addEventListener('click', goPrev);
    nextBtn.addEventListener('click', goNext);

    initialized = true;
  }

  /** Called by app.js right before showing the how-to-play modal, so it
   * always starts fresh at step 1 rather than resuming a stale position. */
  function reset() {
    if (!initialized) setup();
    current = 0;
    render();
  }

  function setCloseHandler(handler) {
    closeHandler = handler;
  }

  window.Tutorial = { reset: reset, setCloseHandler: setCloseHandler };
})();
