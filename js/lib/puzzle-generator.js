/**
 * PuzzleGenerator — samples k target words that are pairwise non-adjacent
 * and whose exact Steiner-tree par falls in [minPar, maxPar], then returns
 * the puzzle. Accepts an optional seed so the same call can later be made
 * deterministic for a daily puzzle without changing this file.
 */
(function (root) {
  'use strict';

  // mulberry32 — small, fast, deterministic PRNG for future seeded (daily) play.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickDistinct(rng, n, count) {
    const chosen = new Set();
    while (chosen.size < count) {
      chosen.add(Math.floor(rng() * n));
    }
    return Array.from(chosen);
  }

  function pairwiseNonAdjacent(graph, indices) {
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        if (graph.isAdjacent(indices[i], indices[j])) return false;
      }
    }
    return true;
  }

  /**
   * @param {WordGraph} graph
   * @param {Object} opts
   * @param {number} [opts.k=3]
   * @param {number} [opts.minPar=5]
   * @param {number} [opts.maxPar=8]
   * @param {number} [opts.maxAttempts=2000]
   * @param {number} [opts.seed] - if provided, generation is deterministic
   */
  function generate(graph, opts) {
    opts = opts || {};
    const k = opts.k || 3;
    const minPar = opts.minPar != null ? opts.minPar : 5;
    const maxPar = opts.maxPar != null ? opts.maxPar : 8;
    const maxAttempts = opts.maxAttempts || 2000;
    const rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
    const n = graph.size();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const indices = pickDistinct(rng, n, k);
      if (!pairwiseNonAdjacent(graph, indices)) continue;
      const par = root.SteinerSolver.minSteinerEdges(graph.adjacency, indices);
      if (par >= minPar && par <= maxPar) {
        return {
          targetIndices: indices,
          targetWords: indices.map((i) => graph.wordAt(i)),
          par: par
        };
      }
    }
    return null;
  }

  root.PuzzleGenerator = { generate: generate, mulberry32: mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
