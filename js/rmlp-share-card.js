/**
 * RMLP Share Card
 * Reusable result rendering for RMLP word puzzle games.
 * Produces (a) a canvas preview card and (b) a paste-anywhere emoji-text
 * string, both driven by the same semantic cell colors so every game's
 * results look and read like they belong to the same family.
 *
 * Usage:
 *   const canvas = RMLP.renderShareCard({
 *     title: 'Word Web No. 1',
 *     stat: '6 words · +1 over par',
 *     cells: ['teal', 'teal', 'gold', 'red', 'rule', 'rule'],
 *     url: 'https://example.com/word-web/'   // optional — omit for no link
 *   });
 *   document.body.appendChild(canvas);
 *
 *   RMLP.shareCardText({
 *     title: 'Word Web No. 1',
 *     stat: '6 words · +1 over par',
 *     cells: ['teal', 'teal', 'gold', 'red', 'rule', 'rule'],
 *     url: 'https://example.com/word-web/'
 *   });
 *   // -> "Word Web No. 1\n6 words · +1 over par\n\uD83D\uDFE6\uD83D\uDFE6\uD83D\uDFE8\uD83D\uDFE5\u2B1C\u2B1C\nhttps://example.com/word-web/"
 */
(function (root) {
const RMLP = (() => {

  // Fallback palette — kept in sync with rmlp-tokens.css. If tokens.css is
  // loaded on the page, the real CSS custom properties are read instead,
  // so this file and the CSS never drift apart silently.
  const DEFAULTS = {
    paper: '#F6EFDD',
    paperRaised: '#FBF6EA',
    ink: '#2A2018',
    inkMuted: '#6E5D4C',
    rule: '#C9B896',
    red: '#C1432B',
    teal: '#1F5C55',
    gold: '#C99A2E',
    invalid: '#A8501B'
  };

  const CSS_VAR_MAP = {
    paper: '--rmlp-paper',
    paperRaised: '--rmlp-paper-raised',
    ink: '--rmlp-ink',
    inkMuted: '--rmlp-ink-muted',
    rule: '--rmlp-rule',
    red: '--rmlp-accent-red',
    teal: '--rmlp-accent-teal',
    gold: '--rmlp-accent-gold',
    invalid: '--rmlp-invalid'
  };

  // Unicode has no true teal square, so the blue square is used as the
  // nearest built-in approximation for the emoji-text variant.
  const EMOJI = {
    red: '\uD83D\uDFE5',
    teal: '\uD83D\uDFE6',
    gold: '\uD83D\uDFE8',
    invalid: '\uD83D\uDFE7',
    rule: '\u2B1C',
    ink: '\u2B1B'
  };

  function getColors() {
    if (typeof document === 'undefined') return DEFAULTS;
    const style = getComputedStyle(document.documentElement);
    const colors = {};
    for (const key in DEFAULTS) {
      const value = style.getPropertyValue(CSS_VAR_MAP[key]).trim();
      colors[key] = value || DEFAULTS[key];
    }
    return colors;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draws a branded share card onto a new canvas and returns it.
   * @param {Object} opts
   * @param {string} opts.title - e.g. 'Word Web No. 1'
   * @param {string} opts.stat - e.g. '6 words · +1 over par'
   * @param {string[]} opts.cells - color keys: 'red' | 'teal' | 'gold' | 'invalid' | 'rule'
   * @param {string} [opts.url] - shown as a caption line under the cells; omit for none
   * @param {string} [opts.accent] - hex color for a thin top accent strip (e.g. a failure-state cue); omit for none
   * @param {number} [opts.width=440]
   * @param {number} [opts.height=240]
   */
  function renderShareCard(opts) {
    const { title, stat, cells = [], url, accent, width = 440 } = opts;
    const hasCells = cells.length > 0;
    const height = opts.height || (hasCells ? (url ? 268 : 240) : (url ? 130 : 100));
    const colors = getColors();

    const canvas = document.createElement('canvas');
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = colors.paper;
    roundRect(ctx, 0, 0, width, height, 16);
    ctx.fill();

    // Inner raised panel
    const pad = 24;
    roundRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 10);
    ctx.fillStyle = colors.paperRaised;
    ctx.fill();
    ctx.strokeStyle = colors.rule;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Optional accent strip along the top of the panel
    if (accent) {
      roundRect(ctx, pad, pad, width - pad * 2, 6, 3);
      ctx.fillStyle = accent;
      ctx.fill();
    }

    // Title
    ctx.fillStyle = colors.ink;
    ctx.font = "700 20px Fraunces, Georgia, serif";
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, pad + 20, pad + 38);

    // Stat line — bold and in the accent color when one's set (e.g. the
    // failure state), otherwise the normal muted tone
    ctx.fillStyle = accent || colors.inkMuted;
    ctx.font = (accent ? "700 " : "") + "13px 'Courier Prime', 'Courier New', monospace";
    ctx.fillText(stat, pad + 20, pad + 60);

    // Result cells
    const cellSize = 26;
    const gap = 6;
    let cx = pad + 20;
    const cy = pad + 82;
    if (hasCells) {
      cells.forEach((key) => {
        ctx.fillStyle = colors[key] || colors.rule;
        roundRect(ctx, cx, cy, cellSize, cellSize, 3);
        ctx.fill();
        cx += cellSize + gap;
      });
    }

    // URL caption — sits right under the cells if there are any, otherwise
    // right under the stat line
    if (url) {
      const urlY = hasCells ? cy + cellSize + 22 : pad + 60 + 24;
      ctx.fillStyle = colors.inkMuted;
      ctx.font = "12px 'Courier Prime', 'Courier New', monospace";
      ctx.fillText(url, pad + 20, urlY);
    }

    return canvas;
  }

  /**
   * Produces a paste-anywhere text version of the same result, for
   * sharing in messages, posts, or any other plain-text context.
   */
  function shareCardText(opts) {
    const { title, stat, cells = [], url } = opts;
    const emojiLine = cells.map((key) => EMOJI[key] || EMOJI.rule).join('');
    const lines = [title, stat, emojiLine, url].filter((line) => !!line);
    return lines.join('\n');
  }

  return { renderShareCard, shareCardText, getColors };
})();
root.RMLP = RMLP;
})(typeof window !== 'undefined' ? window : globalThis);
