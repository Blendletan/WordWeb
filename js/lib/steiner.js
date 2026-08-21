/**
 * SteinerSolver — exact minimum Steiner tree (edge count) for a small set
 * of terminal nodes in an unweighted graph, via the Dreyfus-Wagner DP.
 * k (terminal count) is expected to be small (3 or 4) — this is exact,
 * not a heuristic, which is what lets "par" function as a true floor
 * rather than an average-case estimate.
 */
(function (root) {
  'use strict';

  // Minimal binary min-heap keyed by [distance, node].
  function MinHeap() {
    this.a = [];
  }
  MinHeap.prototype.push = function (d, v) {
    const a = this.a;
    a.push([d, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      const tmp = a[p]; a[p] = a[i]; a[i] = tmp;
      i = p;
    }
  };
  MinHeap.prototype.pop = function () {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        let l = 2 * i + 1, r = 2 * i + 2, smallest = i;
        if (l < n && a[l][0] < a[smallest][0]) smallest = l;
        if (r < n && a[r][0] < a[smallest][0]) smallest = r;
        if (smallest === i) break;
        const tmp = a[smallest]; a[smallest] = a[i]; a[i] = tmp;
        i = smallest;
      }
    }
    return top;
  };
  MinHeap.prototype.size = function () { return this.a.length; };

  function bfsDistances(adjacency, source, n) {
    const dist = new Float64Array(n).fill(Infinity);
    dist[source] = 0;
    const queue = [source];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const nbrs = adjacency[u];
      for (let j = 0; j < nbrs.length; j++) {
        const v = nbrs[j];
        if (dist[v] === Infinity) {
          dist[v] = dist[u] + 1;
          queue.push(v);
        }
      }
    }
    return dist;
  }

  /**
   * @param {number[][]} adjacency - adjacency[i] = array of neighbor indices
   * @param {number[]} terminals - node indices to connect (k small, e.g. 3-4)
   * @returns {number} minimum number of edges in a Steiner tree spanning terminals
   */
  function minSteinerEdges(adjacency, terminals) {
    const k = terminals.length;
    const n = adjacency.length;
    if (k <= 1) return 0;

    const full = (1 << k) - 1;
    const S = new Array(1 << k);

    for (let i = 0; i < k; i++) {
      S[1 << i] = bfsDistances(adjacency, terminals[i], n);
    }

    for (let mask = 1; mask <= full; mask++) {
      if (popcount(mask) < 2) continue;
      const row = S[mask] || new Float64Array(n).fill(Infinity);

      // merge submasks
      for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
        const other = mask ^ sub;
        if (sub < other) continue; // avoid double work, only need sub >= other once
        const a = S[sub], b = S[other];
        if (!a || !b) continue;
        for (let v = 0; v < n; v++) {
          const val = a[v] + b[v];
          if (val < row[v]) row[v] = val;
        }
      }

      // relax across the graph (Dijkstra with unit weights) so paths
      // through extra non-terminal nodes are accounted for
      const heap = new MinHeap();
      for (let v = 0; v < n; v++) {
        if (row[v] < Infinity) heap.push(row[v], v);
      }
      while (heap.size()) {
        const [d, u] = heap.pop();
        if (d > row[u]) continue;
        const nbrs = adjacency[u];
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          const nd = d + 1;
          if (nd < row[v]) {
            row[v] = nd;
            heap.push(nd, v);
          }
        }
      }

      S[mask] = row;
    }

    let best = Infinity;
    const finalRow = S[full];
    for (let v = 0; v < n; v++) {
      if (finalRow[v] < best) best = finalRow[v];
    }
    return best;
  }

  function popcount(x) {
    let c = 0;
    while (x) { c += x & 1; x >>= 1; }
    return c;
  }

  root.SteinerSolver = { minSteinerEdges: minSteinerEdges };
})(typeof window !== 'undefined' ? window : globalThis);
