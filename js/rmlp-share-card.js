/**
 * RMLP Share Card
 * Reusable shareable-result rendering for RMLP word puzzle games.
 * Produces (a) a canvas-based image card and (b) a paste-anywhere emoji-text
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
 *   RMLP.downloadShareCard(canvas, 'word-web-1.png');
 *   RMLP.copyShareCardImage(canvas);
 *
 *   RMLP.shareCardText({
 *     title: 'Word Web No. 1',
 *     stat: '6 words · +1 over par',
 *     cells: ['teal', 'teal', 'gold', 'red', 'rule', 'rule'],
 *     url: 'https://example.com/word-web/'
 *   });
 *   // -> "Word Web No. 1\n6 words · +1 over par\n\uD83D\uDFE6\uD83D\uDFE6\uD83D\uDFE8\uD83D\uDFE5\u2B1C\u2B1C\nhttps://example.com/word-web/"
 */
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
   * @param {number} [opts.width=440]
   * @param {number} [opts.height=240]
   */
  function renderShareCard(opts) {
    const { title, stat, cells = [], url, width = 440 } = opts;
    const height = opts.height || (url ? 240 + 28 : 240);
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

    // Title
    ctx.fillStyle = colors.ink;
    ctx.font = "700 20px Fraunces, Georgia, serif";
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, pad + 20, pad + 38);

    // Stat line
    ctx.fillStyle = colors.inkMuted;
    ctx.font = "13px 'Courier Prime', 'Courier New', monospace";
    ctx.fillText(stat, pad + 20, pad + 60);

    // Result cells
    const cellSize = 26;
    const gap = 6;
    let cx = pad + 20;
    const cy = pad + 82;
    cells.forEach((key) => {
      ctx.fillStyle = colors[key] || colors.rule;
      roundRect(ctx, cx, cy, cellSize, cellSize, 3);
      ctx.fill();
      cx += cellSize + gap;
    });

    // URL caption
    if (url) {
      ctx.fillStyle = colors.inkMuted;
      ctx.font = "12px 'Courier Prime', 'Courier New', monospace";
      ctx.fillText(url, pad + 20, cy + cellSize + 22);
    }

    return canvas;
  }

  function downloadShareCard(canvas, filename = 'share-card.png') {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function copyShareCardImage(canvas) {
    if (!navigator.clipboard || !window.ClipboardItem) {
      throw new Error('Clipboard image copy is not supported in this browser.');
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /**
   * Produces a paste-anywhere text version of the same result, for
   * contexts where an image can't be shared (e.g. a plain text field).
   */
  function shareCardText(opts) {
    const { title, stat, cells = [], url } = opts;
    const emojiLine = cells.map((key) => EMOJI[key] || EMOJI.rule).join('');
    return url ? `${title}\n${stat}\n${emojiLine}\n${url}` : `${title}\n${stat}\n${emojiLine}`;
  }

  return { renderShareCard, downloadShareCard, copyShareCardImage, shareCardText, getColors };
})();
