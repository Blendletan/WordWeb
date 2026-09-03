/**
 * GraphView — renders the growing word web as a D3 force-directed graph,
 * but pins every node in place once it settles. Only a newly added node
 * (and, briefly, its immediate link) is free to move; everything already
 * on the board stays put. That's what keeps the bubbles from jiggling.
 *
 * Bubble size shrinks in tiers as the web grows past a node-count
 * threshold, rather than scrolling or letting nodes run off the board —
 * seeing the whole web at a glance matters more here than keeping bubbles
 * at a fixed size. Crossing a tier is the one deliberate exception to "no
 * jiggle": the board briefly re-settles into the tighter layout, since
 * leaving already-placed bubbles pinned at their old (now oversized)
 * spacing would look broken once everything else shrinks around them.
 *
 * All bubble/thread visuals (gradients, shadows, ring, curve math) come
 * from BubbleTheme (bubble-theme.js), shared with tutorial.js, so the live
 * board and the tutorial slideshow are guaranteed to look alike — load
 * bubble-theme.js before this file.
 */
(function (root) {
  'use strict';

  function GraphView(svgSelector, options) {
    options = options || {};
    this.width = options.width || 720;
    this.height = options.height || 480;
    this.idPrefix = options.idPrefix || 'ww';
    this.solved = false;
    this._batching = false;

    var initialTier = BubbleTheme.tierForCount(0);
    this.nodeRadius = initialTier.radius;
    this.fontSize = initialTier.font;

    this.svg = d3.select(svgSelector)
      .attr('viewBox', '0 0 ' + this.width + ' ' + this.height)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this.svg.append('defs').html(BubbleTheme.defsMarkup(this.idPrefix));

    this.rootGroup = this.svg.append('g').attr('class', 'ww-graph-root');
    this.linkLayer = this.rootGroup.append('g').attr('class', 'ww-links');
    this.nodeLayer = this.rootGroup.append('g').attr('class', 'ww-nodes');

    this.nodes = [];
    this.links = [];
    this.nodeById = new Map();

    var self = this;
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(function (d) { return d.id; }).distance(this.nodeRadius * 2.4).strength(0.9))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('collide', d3.forceCollide(this.nodeRadius + 6))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2).strength(0.02))
      // Continuous bounds clamp — without this, mutual repulsion between
      // enough nodes can push some of them past the visible box over time,
      // not just at the moment they're first placed.
      .force('bounds', function () {
        var r = self.nodeRadius;
        self.nodes.forEach(function (n) {
          if (n.x < r) n.x = r;
          else if (n.x > self.width - r) n.x = self.width - r;
          if (n.y < r) n.y = r;
          else if (n.y > self.height - r) n.y = self.height - r;
        });
      })
      .alphaDecay(0.08)
      .on('tick', function () { self._render(); })
      .on('end', function () { self._pinAll(); });
  }

  GraphView.prototype.reset = function () {
    var initialTier = BubbleTheme.tierForCount(0);
    this.nodes = [];
    this.links = [];
    this.nodeById.clear();
    this.solved = false;
    this._batching = false;
    this.nodeRadius = initialTier.radius;
    this.fontSize = initialTier.font;
    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);
    this.simulation.force('link').distance(this.nodeRadius * 2.4);
    this.simulation.force('collide').radius(this.nodeRadius + 6);
    this.linkLayer.selectAll('*').remove();
    this.nodeLayer.selectAll('*').remove();
  };

  GraphView.prototype._pinAll = function () {
    this.nodes.forEach(function (n) { n.fx = n.x; n.fy = n.y; });
  };

  /**
   * Call before adding several nodes back-to-back (Reveal Answer, or
   * replaying a saved session on load) so they can settle together as a
   * group instead of each one freezing the previous ones in place before
   * physics ever gets a chance to spread them apart. Without this, a
   * burst of addNode() calls with no render in between (nothing paints
   * between synchronous statements) pins each new node's neighbors at
   * their raw, unsettled spawn position — visible overlap, not just
   * tight spacing. Normal one-at-a-time play never hits this, since
   * there's a real pause between each typed word.
   */
  GraphView.prototype.beginBatch = function () {
    this._pinAll(); // freeze whatever already existed before this batch
    this._batching = true;
  };

  GraphView.prototype.endBatch = function () {
    this._batching = false;
    this.simulation.alpha(0.8).restart();
  };

  /**
   * @param {number} id - stable word-graph index
   * @param {string} word
   * @param {Object} [opts]
   * @param {boolean} [opts.isTarget]
   * @param {boolean} [opts.revealed] - styled distinctly: a word the player hadn't found
   * @param {number} [opts.parentId] - existing node this one connects from
   */
  GraphView.prototype.addNode = function (id, word, opts) {
    opts = opts || {};
    if (this.nodeById.has(id)) return;

    // Outside a batch, pin everything already on the board before adding
    // this one node, so reheating only moves the new arrival. Inside a
    // batch, beginBatch() already did this once for the pre-batch state —
    // nodes added earlier in the same batch stay free so the whole group
    // can settle together (see beginBatch's doc comment).
    if (!this._batching) {
      this._pinAll();
    }

    var newTier = BubbleTheme.tierForCount(this.nodes.length + 1);
    var tierChanged = newTier.radius !== this.nodeRadius;
    if (tierChanged) {
      this.nodes.forEach(function (n) { n.fx = null; n.fy = null; });
    }
    this.nodeRadius = newTier.radius;
    this.fontSize = newTier.font;
    this.simulation.force('collide').radius(this.nodeRadius + 6);
    this.simulation.force('link').distance(this.nodeRadius * 2.4);

    var parent = opts.parentId != null ? this.nodeById.get(opts.parentId) : null;
    var x, y;
    if (parent) {
      var angle = Math.random() * Math.PI * 2;
      var dist = 60 + Math.random() * 20;
      x = parent.x + Math.cos(angle) * dist;
      y = parent.y + Math.sin(angle) * dist;
    } else {
      var rootCount = this.nodes.filter(function (n) { return n.isTarget; }).length;
      var rootAngle = (rootCount / 3) * Math.PI * 2 - Math.PI / 2;
      x = this.width / 2 + Math.cos(rootAngle) * 110;
      y = this.height / 2 + Math.sin(rootAngle) * 110;
    }
    x = Math.max(this.nodeRadius, Math.min(this.width - this.nodeRadius, x));
    y = Math.max(this.nodeRadius, Math.min(this.height - this.nodeRadius, y));

    var node = { id: id, word: word, isTarget: !!opts.isTarget, revealed: !!opts.revealed, x: x, y: y };
    this.nodes.push(node);
    this.nodeById.set(id, node);

    if (parent) {
      this.links.push({ source: parent.id, target: node.id, bowSide: Math.random() < 0.5 ? 1 : -1 });
    }

    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);

    if (!this._batching) {
      this.simulation.alpha(tierChanged ? 0.8 : 0.55).restart();
    }
  };

  /**
   * Links two nodes that are both already on the board (e.g. when a new
   * connection merges two previously separate branches of the web).
   * Both endpoints are already pinned, so this just draws the thread —
   * nothing moves.
   */
  GraphView.prototype.addLinkBetweenExisting = function (aId, bId) {
    if (!this.nodeById.has(aId) || !this.nodeById.has(bId)) return;
    this.links.push({ source: aId, target: bId, bowSide: Math.random() < 0.5 ? 1 : -1 });
    this.simulation.force('link').links(this.links);
    this._render();
  };

  GraphView.prototype.markSolved = function () {
    this.solved = true;
    this._render();
  };

  GraphView.prototype._render = function () {
    var self = this;
    var idPrefix = this.idPrefix;

    var link = this.linkLayer.selectAll('path.ww-link')
      .data(this.links, function (d) {
        return (d.source.id !== undefined ? d.source.id : d.source) + '-' + (d.target.id !== undefined ? d.target.id : d.target);
      });
    var linkEnter = link.enter().append('path').attr('class', 'ww-link').attr('fill', 'none');
    linkEnter.merge(link)
      .attr('d', function (d) { return BubbleTheme.edgePath(d.source.x, d.source.y, d.target.x, d.target.y, d.bowSide); })
      .attr('stroke', self.solved ? '#C99A2E' : '#8A7355')
      .attr('stroke-width', self.solved ? 2.5 : 2)
      .attr('stroke-linecap', 'round');
    link.exit().remove();

    var node = this.nodeLayer.selectAll('g.ww-node')
      .data(this.nodes, function (d) { return d.id; });

    var nodeEnter = node.enter().append('g').attr('class', 'ww-node');
    nodeEnter.append('circle').attr('class', 'ww-node-ring').attr('fill', 'none');
    nodeEnter.append('circle').attr('class', 'ww-node-circle');
    nodeEnter.append('text')
      .attr('class', 'ww-node-label')
      .attr('text-anchor', 'middle')
      .attr('font-family', "'Courier Prime',monospace")
      .attr('font-weight', '700')
      .attr('pointer-events', 'none')
      .text(function (d) { return d.word; });

    var merged = nodeEnter.merge(node);
    merged.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });

    merged.each(function (d) {
      var g = d3.select(this);
      var kind = d.revealed ? 'revealed' : (d.isTarget ? 'target' : 'normal');
      var showRing = d.isTarget || self.solved;
      var ringColor = self.solved ? '#C99A2E' : '#2A2018';
      var ringRadius = self.nodeRadius + BubbleTheme.ringOffsetFor(self.nodeRadius);
      var fontSize = BubbleTheme.fontSizeFor(self.nodeRadius);

      g.select('circle.ww-node-ring')
        .attr('r', ringRadius)
        .attr('stroke', ringColor)
        .attr('stroke-width', self.solved ? 1.5 : 1)
        .attr('opacity', showRing ? (self.solved ? 1 : 0.3) : 0);

      g.select('circle.ww-node-circle')
        .attr('r', self.nodeRadius)
        .attr('fill', 'url(#' + BubbleTheme.gradientIdFor(kind, idPrefix) + ')')
        .attr('filter', 'url(#' + BubbleTheme.shadowIdFor(self.nodeRadius, idPrefix) + ')');

      g.select('text.ww-node-label')
        .attr('y', fontSize * 0.35)
        .attr('font-size', fontSize)
        .attr('fill', BubbleTheme.textFillFor(kind));
    });

    node.exit().remove();
  };

  root.GraphView = GraphView;
})(typeof window !== 'undefined' ? window : globalThis);
