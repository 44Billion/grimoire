/**
 * Avatar shapes are stored in kind-0 metadata as a `shape` property holding an
 * emoji. The glyph is rendered to a canvas and used as a CSS mask, so the
 * avatar takes the emoji's silhouette instead of the default circle.
 */

/** Emoji are short and non-ASCII; matching specific Unicode ranges breaks on
 * ZWJ sequences, flags, and keycaps. */
export function isEmoji(value: string): boolean {
  if (!value) return false;
  if (value.length > 20) return false;
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(value);
}

export function isValidAvatarShape(value: unknown): value is string {
  return typeof value === "string" && isEmoji(value);
}

/** Reads a valid shape out of profile metadata; `undefined` means circle. */
export function getAvatarShape(
  metadata: { [key: string]: unknown } | undefined,
): string | undefined {
  const raw = metadata?.shape;
  return isValidAvatarShape(raw) ? raw : undefined;
}

/** emoji → PNG data-URL mask */
const maskCache = new Map<string, string>();

/**
 * Renders the OS emoji glyph to a canvas and returns a PNG data-URL alpha mask
 * for `mask-image`. Draws oversized, crops to the glyph's tight bounding box,
 * squares that box so non-square emoji aren't stretched, then whitens every
 * pixel while keeping alpha. Returns "" if nothing could be drawn.
 */
export function getEmojiMaskUrl(emoji: string): string {
  const cached = maskCache.get(emoji);
  if (cached) return cached;

  const fontSize = 512;
  const scratch = fontSize * 1.5;
  const c1 = document.createElement("canvas");
  c1.width = scratch;
  c1.height = scratch;
  const ctx1 = c1.getContext("2d");
  if (!ctx1) return "";

  ctx1.textAlign = "center";
  ctx1.textBaseline = "middle";
  ctx1.font = `${fontSize}px serif`;
  ctx1.fillText(emoji, scratch / 2, scratch / 2);

  // Ignore shadows, glows, and anti-aliasing fringes — they inflate the box
  // and push the glyph off-centre once the crop is squared.
  const ALPHA_THRESHOLD = 25;
  const {
    data: px,
    width: sw,
    height: sh,
  } = ctx1.getImageData(0, 0, scratch, scratch);
  let t = sh;
  let b = 0;
  let l = sw;
  let r = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (px[(y * sw + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (y < t) t = y;
        if (y > b) b = y;
        if (x < l) l = x;
        if (x > r) r = x;
      }
    }
  }
  if (r < l || b < t) return "";

  let cropW = r - l + 1;
  let cropH = b - t + 1;
  if (cropW > cropH) {
    t -= Math.floor((cropW - cropH) / 2);
    cropH = cropW;
  } else if (cropH > cropW) {
    l -= Math.floor((cropH - cropW) / 2);
    cropW = cropH;
  }
  if (t < 0) t = 0;
  if (l < 0) l = 0;

  const out = 256;
  const c2 = document.createElement("canvas");
  c2.width = out;
  c2.height = out;
  const ctx2 = c2.getContext("2d");
  if (!ctx2) return "";

  ctx2.drawImage(c1, l, t, cropW, cropH, 0, 0, out, out);

  const img = ctx2.getImageData(0, 0, out, out);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
  }
  ctx2.putImageData(img, 0, 0);

  const url = c2.toDataURL("image/png");
  maskCache.set(emoji, url);
  return url;
}
