/**
 * GraphView — renders the growing word web as a D3 force-directed graph,
 * but pins every node in place once it settles. Only a newly added node
 * (and, briefly, its immediate link) is free to move; everything already
 * on the board stays put. That's what keeps the bubbles from jiggling.
 */
(function (root) {
  'use strict';

  function GraphView(svgSelector, options) {
    options = options || {};
    this.width = options.width || 640;
    this.height = options.height || 420;
    this.nodeRadius = options.nodeRadius || 26;
    this.onNodeClick = options.onNodeClick || function () {};

    this.svg = d3.select(svgSelector)
      .attr('viewBox', '0 0 ' + this.width + ' ' + this.height)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this.rootGroup = this.svg.append('g').attr('class', 'ww-graph-root');
    this.linkLayer = this.rootGroup.append('g').attr('class', 'ww-links');
    this.nodeLayer = this.rootGroup.append('g').attr('class', 'ww-nodes');

    this.nodes = [];
    this.links = [];
    this.nodeById = new Map();
    this.selectedId = null;

    const self = this;
    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.links).id(function (d) { return d.id; }).distance(64).strength(0.9))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('collide', d3.forceCollide(this.nodeRadius + 6))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2).strength(0.02))
      .alphaDecay(0.08)
      .on('tick', function () { self._render(); })
      .on('end', function () { self._pinAll(); });
  }

  GraphView.prototype.reset = function () {
    this.nodes = [];
    this.links = [];
    this.nodeById.clear();
    this.selectedId = null;
    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);
    this.linkLayer.selectAll('*').remove();
    this.nodeLayer.selectAll('*').remove();
    this.svg.classed('ww-solved', false);
  };

  GraphView.prototype._pinAll = function () {
    this.nodes.forEach(function (n) { n.fx = n.x; n.fy = n.y; });
  };

  /**
   * @param {number} id - stable word-graph index
   * @param {string} word
   * @param {Object} [opts]
   * @param {boolean} [opts.isTarget]
   * @param {number} [opts.parentId] - existing node this one connects from
   */
  GraphView.prototype.addNode = function (id, word, opts) {
    opts = opts || {};
    if (this.nodeById.has(id)) return;

    // Pin everything already on the board so reheating the simulation
    // only moves the node we're about to add.
    this._pinAll();

    const parent = opts.parentId != null ? this.nodeById.get(opts.parentId) : null;
    let x, y;
    if (parent) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 20;
      x = parent.x + Math.cos(angle) * dist;
      y = parent.y + Math.sin(angle) * dist;
    } else {
      const rootCount = this.nodes.filter(function (n) { return n.isTarget; }).length;
      const angle = (rootCount / 3) * Math.PI * 2 - Math.PI / 2;
      x = this.width / 2 + Math.cos(angle) * 110;
      y = this.height / 2 + Math.sin(angle) * 110;
    }
    x = Math.max(this.nodeRadius, Math.min(this.width - this.nodeRadius, x));
    y = Math.max(this.nodeRadius, Math.min(this.height - this.nodeRadius, y));

    const node = { id: id, word: word, isTarget: !!opts.isTarget, x: x, y: y };
    this.nodes.push(node);
    this.nodeById.set(id, node);

    if (parent) {
      this.links.push({ source: parent.id, target: node.id });
    }

    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);
    this.simulation.alpha(0.55).restart();
  };

  /**
   * Links two nodes that are both already on the board (e.g. when a new
   * connection merges two previously separate branches of the web).
   * Both endpoints are already pinned, so this just draws the edge —
   * nothing moves.
   */
  GraphView.prototype.addLinkBetweenExisting = function (aId, bId) {
    if (!this.nodeById.has(aId) || !this.nodeById.has(bId)) return;
    this.links.push({ source: aId, target: bId });
    this.simulation.force('link').links(this.links);
    this._render();
  };

  GraphView.prototype.setSelected = function (id) {
    this.selectedId = id;
    this._render();
  };

  GraphView.prototype.markSolved = function () {
    this.svg.classed('ww-solved', true);
  };

  GraphView.prototype._render = function () {
    const self = this;

    const link = this.linkLayer.selectAll('line.ww-link')
      .data(this.links, function (d) {
        return (d.source.id !== undefined ? d.source.id : d.source) + '-' + (d.target.id !== undefined ? d.target.id : d.target);
      });
    link.enter().append('line').attr('class', 'ww-link').merge(link)
      .attr('x1', function (d) { return d.source.x; })
      .attr('y1', function (d) { return d.source.y; })
      .attr('x2', function (d) { return d.target.x; })
      .attr('y2', function (d) { return d.target.y; });
    link.exit().remove();

    const node = this.nodeLayer.selectAll('g.ww-node')
      .data(this.nodes, function (d) { return d.id; });

    const nodeEnter = node.enter().append('g')
      .attr('class', 'ww-node')
      .style('cursor', 'pointer')
      .on('click', function (event, d) { self.onNodeClick(d.id); });

    nodeEnter.append('circle').attr('class', 'ww-node-circle').attr('r', this.nodeRadius);
    nodeEnter.append('text').attr('class', 'ww-node-label').text(function (d) { return d.word; });

    const merged = nodeEnter.merge(node);
    merged.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; })
      .classed('is-target', function (d) { return d.isTarget; })
      .classed('is-selected', function (d) { return d.id === self.selectedId; });

    node.exit().remove();
  };

  root.GraphView = GraphView;
})(typeof window !== 'undefined' ? window : globalThis);
