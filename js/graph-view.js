/**
 * GraphView — renders the growing word web as a D3 force-directed graph,
 * but pins nodes in place once they settle. Newly added nodes remain free
 * until the current settle finishes, while everything already stable on
 * the board stays put. That's what keeps the bubbles from jiggling without
 * freezing a rapid addition too early.
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
    this._settlingIds = new Set();

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
      .force('link', d3.forceLink(this.links).id(function (d) { return d.id; }).distance(this._preferredLinkDistance()).strength(0.9))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('collide', d3.forceCollide(this._collisionRadius()).strength(1).iterations(3))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2).strength(0.02))
      // Continuous bounds clamp — without this, mutual repulsion between
      // enough nodes can push some of them past the visible box over time,
      // not just at the moment they're first placed.
      .force('bounds', function () {
        var r = self._collisionRadius();
        self.nodes.forEach(function (n) {
          if (n.x < r) n.x = r;
          else if (n.x > self.width - r) n.x = self.width - r;
          if (n.y < r) n.y = r;
          else if (n.y > self.height - r) n.y = self.height - r;
        });
      })
      .alphaDecay(0.08)
      .on('tick', function () { self._render(); })
      .on('end', function () { self._finishSettling(); });

    this.dragBehavior = d3.drag()
      .on('start', function (event, d) {
        d.manuallyPositioned = true;
        self._settlingIds.delete(d.id);
        d.fx = d.x;
        d.fy = d.y;
        d3.select(this).classed('is-dragging', true).raise();
      })
      .on('drag', function (event, d) {
        self._moveNode(d, event.x, event.y);
      })
      .on('end', function (event, d) {
        self._moveNode(d, event.x, event.y);
        d3.select(this).classed('is-dragging', false);
      });
  }

  GraphView.prototype._visualRadius = function () {
    return this.nodeRadius + BubbleTheme.ringOffsetFor(this.nodeRadius);
  };

  GraphView.prototype._collisionRadius = function () {
    return this._visualRadius() + 3;
  };

  GraphView.prototype._preferredLinkDistance = function () {
    return this._collisionRadius() * 2.05;
  };

  GraphView.prototype._clampPosition = function (x, y) {
    var r = this._collisionRadius();
    return {
      x: Math.max(r, Math.min(this.width - r, x)),
      y: Math.max(r, Math.min(this.height - r, y))
    };
  };

  GraphView.prototype._moveNode = function (node, x, y) {
    var position = this._clampPosition(x, y);
    node.x = position.x;
    node.y = position.y;
    node.fx = position.x;
    node.fy = position.y;
    node.vx = 0;
    node.vy = 0;
    this._render();
  };

  GraphView.prototype._connectedNodes = function (ids) {
    var self = this;
    return (ids || []).map(function (id) {
      return self.nodeById.get(id);
    }).filter(Boolean);
  };

  GraphView.prototype._candidateScore = function (candidate, connectedNodes) {
    var requiredDistance = this._collisionRadius() * 2;
    var preferredDistance = this._preferredLinkDistance();
    var overlap = 0;
    var nearestClearance = Infinity;

    this.nodes.forEach(function (node) {
      var dx = candidate.x - node.x;
      var dy = candidate.y - node.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var clearance = distance - requiredDistance;
      if (clearance < 0) overlap += -clearance;
      if (clearance < nearestClearance) nearestClearance = clearance;
    });

    var linkCost = 0;
    connectedNodes.forEach(function (node) {
      var dx = candidate.x - node.x;
      var dy = candidate.y - node.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var difference = distance - preferredDistance;
      linkCost += difference * difference;
    });

    if (!connectedNodes.length) linkCost = 0;
    if (nearestClearance === Infinity) nearestClearance = requiredDistance;

    return {
      overlap: overlap,
      cost: linkCost - Math.min(nearestClearance, requiredDistance) * 12
    };
  };

  GraphView.prototype._bestPosition = function (id, connectedNodes) {
    if (!connectedNodes.length) {
      var rootCount = this.nodes.filter(function (n) { return n.isTarget; }).length;
      var rootAngle = (rootCount / 3) * Math.PI * 2 - Math.PI / 2;
      return this._clampPosition(
        this.width / 2 + Math.cos(rootAngle) * 110,
        this.height / 2 + Math.sin(rootAngle) * 110
      );
    }

    var anchor = connectedNodes.reduce(function (sum, node) {
      sum.x += node.x;
      sum.y += node.y;
      return sum;
    }, { x: 0, y: 0 });
    anchor.x /= connectedNodes.length;
    anchor.y /= connectedNodes.length;

    var preferred = this._preferredLinkDistance();
    var radii = [0, preferred * 0.75, preferred, preferred * 1.25, preferred * 1.75, preferred * 2.35, preferred * 3];
    var samples = 24;
    var angleOffset = ((id * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
    var candidates = [];
    var seen = new Set();
    var self = this;

    function addCandidate(x, y) {
      var position = self._clampPosition(x, y);
      var key = Math.round(position.x * 10) + ':' + Math.round(position.y * 10);
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(position);
    }

    radii.forEach(function (radius, radiusIndex) {
      if (radiusIndex === 0) {
        addCandidate(anchor.x, anchor.y);
        return;
      }
      for (var i = 0; i < samples; i++) {
        var angle = angleOffset + (i / samples) * Math.PI * 2;
        addCandidate(anchor.x + Math.cos(angle) * radius, anchor.y + Math.sin(angle) * radius);
      }
    });

    var gridStep = this._collisionRadius() * 2;
    for (var y = this._collisionRadius(); y <= this.height - this._collisionRadius(); y += gridStep) {
      for (var x = this._collisionRadius(); x <= this.width - this._collisionRadius(); x += gridStep) {
        addCandidate(x, y);
      }
    }

    var bestClear = null;
    var bestBlocked = null;
    candidates.forEach(function (candidate) {
      var score = self._candidateScore(candidate, connectedNodes);
      var evaluated = { x: candidate.x, y: candidate.y, overlap: score.overlap, cost: score.cost };
      if (score.overlap <= 0.01) {
        if (!bestClear || evaluated.cost < bestClear.cost) bestClear = evaluated;
      } else if (!bestBlocked || evaluated.overlap < bestBlocked.overlap ||
          (evaluated.overlap === bestBlocked.overlap && evaluated.cost < bestBlocked.cost)) {
        bestBlocked = evaluated;
      }
    });

    return bestClear || bestBlocked || this._clampPosition(anchor.x, anchor.y);
  };

  GraphView.prototype._resolveOverlaps = function () {
    var self = this;
    var requiredDistance = this._collisionRadius() * 2;
    var maxPasses = 80;

    for (var pass = 0; pass < maxPasses; pass++) {
      var moved = false;

      for (var i = 0; i < this.nodes.length; i++) {
        for (var j = i + 1; j < this.nodes.length; j++) {
          var a = this.nodes[i];
          var b = this.nodes[j];
          var aMovable = this._settlingIds.has(a.id);
          var bMovable = this._settlingIds.has(b.id);
          if (!aMovable && !bMovable) continue;

          var dx = b.x - a.x;
          var dy = b.y - a.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= requiredDistance - 0.1) continue;

          if (distance < 0.001) {
            var angle = (((a.id + 1) * 31 + (b.id + 1) * 17) % 360) * Math.PI / 180;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            distance = 1;
          }

          var push = requiredDistance - distance + 0.5;
          var ux = dx / distance;
          var uy = dy / distance;
          if (aMovable && bMovable) {
            a.x -= ux * push / 2;
            a.y -= uy * push / 2;
            b.x += ux * push / 2;
            b.y += uy * push / 2;
          } else if (aMovable) {
            a.x -= ux * push;
            a.y -= uy * push;
          } else {
            b.x += ux * push;
            b.y += uy * push;
          }
          moved = true;
        }
      }

      this.nodes.forEach(function (node) {
        if (!self._settlingIds.has(node.id)) return;
        var position = self._clampPosition(node.x, node.y);
        node.x = position.x;
        node.y = position.y;
        node.vx = 0;
        node.vy = 0;
      });

      if (!moved) break;
    }
  };

  GraphView.prototype._finishSettling = function () {
    this._resolveOverlaps();
    this._render();
    this._pinAll();
  };

  GraphView.prototype.reset = function () {
    var initialTier = BubbleTheme.tierForCount(0);
    this.nodes = [];
    this.links = [];
    this.nodeById.clear();
    this.solved = false;
    this._batching = false;
    this._settlingIds.clear();
    this.nodeRadius = initialTier.radius;
    this.fontSize = initialTier.font;
    this.simulation.stop();
    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);
    this.simulation.force('link').distance(this._preferredLinkDistance());
    this.simulation.force('collide').radius(this._collisionRadius());
    this.linkLayer.selectAll('*').remove();
    this.nodeLayer.selectAll('*').remove();
  };

  GraphView.prototype._pinAll = function () {
    this.nodes.forEach(function (n) {
      n.fx = n.x;
      n.fy = n.y;
      n.vx = 0;
      n.vy = 0;
    });
    this._settlingIds.clear();
  };

  /**
   * Call before adding several nodes back-to-back (Reveal Answer, or
   * replaying a saved session on load) so they can settle together as a
   * group. Nodes that were already settling remain free as well, which
   * matters when a terminal submission immediately starts an optimal-answer
   * batch before that submitted bubble has cooled.
   */
  GraphView.prototype.beginBatch = function () {
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
   * @param {number[]} [opts.connectedIds] - every existing node this one connects to
   */
  GraphView.prototype.addNode = function (id, word, opts) {
    opts = opts || {};
    if (this.nodeById.has(id)) return;

    var newTier = BubbleTheme.tierForCount(this.nodes.length + 1);
    var tierChanged = newTier.radius !== this.nodeRadius;
    if (tierChanged) {
      var self = this;
      this.nodes.forEach(function (n) {
        if (n.manuallyPositioned) return;
        n.fx = null;
        n.fy = null;
        self._settlingIds.add(n.id);
      });
    }
    this.nodeRadius = newTier.radius;
    this.fontSize = newTier.font;
    this.simulation.force('collide').radius(this._collisionRadius());
    this.simulation.force('link').distance(this._preferredLinkDistance());

    var parent = opts.parentId != null ? this.nodeById.get(opts.parentId) : null;
    var connectedIds = opts.connectedIds || (parent ? [parent.id] : []);
    var connectedNodes = this._connectedNodes(connectedIds);
    var position = this._bestPosition(id, connectedNodes);

    var node = {
      id: id,
      word: word,
      isTarget: !!opts.isTarget,
      revealed: !!opts.revealed,
      x: position.x,
      y: position.y
    };
    this.nodes.push(node);
    this.nodeById.set(id, node);
    this._settlingIds.add(id);

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
   * The endpoints may still be settling, so updating the link force lets
   * the current simulation account for the new thread without moving nodes
   * that were already pinned.
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
    merged
      .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; })
      .attr('tabindex', 0)
      .attr('role', 'graphics-symbol')
      .attr('aria-label', function (d) {
        return d.word.toUpperCase() + ' word bubble. Drag or use arrow keys to reposition.';
      })
      .call(this.dragBehavior)
      .on('keydown.position', function (event, d) {
        var dx = 0;
        var dy = 0;
        var step = event.shiftKey ? 24 : 8;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;
        else return;

        event.preventDefault();
        d.manuallyPositioned = true;
        self._settlingIds.delete(d.id);
        self._moveNode(d, d.x + dx, d.y + dy);
      });

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
