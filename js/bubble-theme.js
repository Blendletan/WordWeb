/**
 * BubbleTheme — the single source of visual truth for how word bubbles and
 * connecting threads are drawn. Both graph-view.js (the live, physics-driven
 * board) and tutorial.js (the scripted slideshow) draw through this same
 * module, so a style change here changes both at once — the two are
 * guaranteed to look alike by construction, not by two copies of the same
 * hardcoded values quietly drifting apart later.
 *
 * Two levels of API on purpose:
 *  - Low-level pieces (tierForCount, gradientIdFor, edgePath, ...) for
 *    graph-view.js, which drives its own D3 attr-based rendering and needs
 *    values, not markup strings.
 *  - bubbleMarkup(), a higher-level string builder, for tutorial.js, which
 *    just redraws a static SVG's innerHTML on every step change and has no
 *    D3 update-pattern to fit into.
 */
(function (root) {
  'use strict';

  // Three size tiers, keyed by how many nodes are on the board. Matches the
  // thresholds that already fixed the overflow problem — this just adds
  // proportional shadow/ring sizing on top so the smallest tier doesn't
  // look muddy once those effects are added.
  var TIERS = [
    { max: 10, radius: 32, font: 15 },
    { max: 16, radius: 24, font: 12 },
    { max: Infinity, radius: 18, font: 10 }
  ];

  function tierForCount(count) {
    for (var i = 0; i < TIERS.length; i++) {
      if (count <= TIERS[i].max) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  function defsMarkup(idPrefix) {
    idPrefix = idPrefix || 'ww';
    return (
      '<radialGradient id="' + idPrefix + 'TealG" cx="35%" cy="30%" r="75%">' +
        '<stop offset="0%" stop-color="#2E7A70"/><stop offset="100%" stop-color="#1F5C55"/>' +
      '</radialGradient>' +
      '<radialGradient id="' + idPrefix + 'PaperG" cx="35%" cy="30%" r="75%">' +
        '<stop offset="0%" stop-color="#FFFDF6"/><stop offset="100%" stop-color="#FBF6EA"/>' +
      '</radialGradient>' +
      '<radialGradient id="' + idPrefix + 'WasteG" cx="35%" cy="30%" r="75%">' +
        '<stop offset="0%" stop-color="#C15A34"/><stop offset="100%" stop-color="#A8501B"/>' +
      '</radialGradient>' +
      '<filter id="' + idPrefix + 'ShadowLg" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#2A2018" flood-opacity="0.28"/></filter>' +
      '<filter id="' + idPrefix + 'ShadowMd" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="2.5" stdDeviation="2" flood-color="#2A2018" flood-opacity="0.28"/></filter>' +
      '<filter id="' + idPrefix + 'ShadowSm" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-color="#2A2018" flood-opacity="0.28"/></filter>'
    );
  }

  function shadowIdFor(radius, idPrefix) {
    idPrefix = idPrefix || 'ww';
    if (radius >= 30) return idPrefix + 'ShadowLg';
    if (radius >= 22) return idPrefix + 'ShadowMd';
    return idPrefix + 'ShadowSm';
  }

  function gradientIdFor(kind, idPrefix) {
    idPrefix = idPrefix || 'ww';
    if (kind === 'target') return idPrefix + 'TealG';
    if (kind === 'revealed') return idPrefix + 'WasteG';
    return idPrefix + 'PaperG';
  }

  function textFillFor(kind) {
    return kind === 'normal' ? '#2A2018' : '#F6EFDD';
  }

  function ringOffsetFor(radius) {
    return Math.max(3, Math.round(radius * 0.18));
  }

  function fontSizeFor(radius) {
    return Math.max(9, Math.round(radius * 0.42));
  }

  /**
   * @param {Object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} opts.radius
   * @param {string} opts.label - already uppercase
   * @param {'target'|'normal'|'revealed'} opts.kind
   * @param {string} [opts.idPrefix]
   */
  function bubbleMarkup(opts) {
    var idPrefix = opts.idPrefix || 'ww';
    var x = opts.x, y = opts.y, r = opts.radius;
    var ring = opts.ring != null ? opts.ring : ringOffsetFor(r);
    var fontSize = opts.fontSize || fontSizeFor(r);
    var gradId = gradientIdFor(opts.kind, idPrefix);
    var shadowId = shadowIdFor(r, idPrefix);
    var textFill = textFillFor(opts.kind);

    var ringMarkup = opts.kind === 'target'
      ? '<circle cx="' + x + '" cy="' + y + '" r="' + (r + ring) + '" fill="none" stroke="#2A2018" stroke-width="1" opacity="0.3"/>'
      : '';

    return ringMarkup +
      '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#' + gradId + ')" filter="url(#' + shadowId + ')"/>' +
      '<text x="' + x + '" y="' + (y + fontSize * 0.35) + '" text-anchor="middle" font-family="\'Courier Prime\',monospace" font-weight="700" font-size="' + fontSize + '" fill="' + textFill + '">' + opts.label + '</text>';
  }

  /**
   * Quadratic-bezier "thread" between two points — the corkboard-string
   * look, not a straight graph edge. bowSide (+1/-1) picks which
   * perpendicular direction to bow toward; the caller should store this
   * once per edge and pass the same value every tick, not re-randomize it,
   * or the thread will visibly flip during a physics settle.
   */
  function edgePath(x1, y1, x2, y2, bowSide) {
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / dist;
    var py = dx / dist;
    var bow = Math.min(dist * 0.18, 22) * (bowSide || 1);
    var cx = mx + px * bow;
    var cy = my + py * bow;
    return 'M' + x1 + ',' + y1 + ' Q' + cx + ',' + cy + ' ' + x2 + ',' + y2;
  }

  root.BubbleTheme = {
    TIERS: TIERS,
    tierForCount: tierForCount,
    defsMarkup: defsMarkup,
    shadowIdFor: shadowIdFor,
    gradientIdFor: gradientIdFor,
    textFillFor: textFillFor,
    ringOffsetFor: ringOffsetFor,
    fontSizeFor: fontSizeFor,
    bubbleMarkup: bubbleMarkup,
    edgePath: edgePath
  };
})(typeof window !== 'undefined' ? window : globalThis);
