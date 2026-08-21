/**
 * WordGraph — thin accessor over the precomputed 5-letter word adjacency
 * data (data/words.json). Two words are adjacent iff they are the same
 * length and differ in exactly one letter position.
 */
(function (root) {
  'use strict';

  function WordGraph(data) {
    this.words = data.words;                 // string[]
    this.adjacency = data.adjacency;          // number[][] (neighbor indices)
    this._index = new Map();
    for (let i = 0; i < this.words.length; i++) {
      this._index.set(this.words[i], i);
    }
  }

  WordGraph.prototype.size = function () {
    return this.words.length;
  };

  WordGraph.prototype.indexOf = function (word) {
    const i = this._index.get(word.toLowerCase());
    return i === undefined ? -1 : i;
  };

  WordGraph.prototype.wordAt = function (index) {
    return this.words[index];
  };

  WordGraph.prototype.hasWord = function (word) {
    return this._index.has(word.toLowerCase());
  };

  WordGraph.prototype.neighborsOf = function (index) {
    return this.adjacency[index];
  };

  WordGraph.prototype.isAdjacent = function (indexA, indexB) {
    return this.adjacency[indexA].includes(indexB);
  };

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load word graph: ' + res.status);
    const data = await res.json();
    return new WordGraph(data);
  }

  root.WordGraph = { WordGraph: WordGraph, load: load };
})(typeof window !== 'undefined' ? window : globalThis);
