// Pixel-level I/O and operations for the Razavi fidelity diff harness.
//
// The harness compares a rasterized symbol (from resvg, RGBA Uint8Array) against
// a crop of the reference six-panel PNG (decoded via pngjs). This module isolates
// every pixel operation so the comparison core stays pure and testable.
//
// Conventions:
//   - Raster images are represented as { width, height, data: Uint8Array }
//     where data is RGBA (4 bytes/px), row-major, top-to-bottom.
//   - A "mask" is a Uint8Array of width*height with 1 = ink, 0 = background.

import { PNG } from "pngjs";

/**
 * A decoded RGBA raster. `data` length === width * height * 4.
 * @typedef {Object} Raster
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 */

/**
 * Decode a PNG file (bytes) into an RGBA raster via pngjs.
 * @param {Buffer | Uint8Array} pngBytes
 * @returns {Promise<{width:number,height:number,data:Uint8Array}>}
 */
export async function decodePng(pngBytes) {
  return new Promise((resolveFn, reject) => {
    new PNG().parse(Buffer.from(pngBytes), (error, parsed) => {
      if (error) reject(error);
      else
        resolveFn({
          width: parsed.width,
          height: parsed.height,
          data: Uint8Array.from(parsed.data),
        });
    });
  });
}

/**
 * Encode an RGBA raster to PNG bytes via pngjs.
 * @param {{width:number,height:number,data:Uint8Array}} raster
 * @returns {Promise<Buffer>}
 */
export async function encodePng(raster) {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.data);
  return new Promise((resolveFn, reject) => {
    const chunks = [];
    png
      .pack()
      .on("data", (/** @type {Buffer} */ chunk) => chunks.push(chunk))
      .on("end", () => resolveFn(Buffer.concat(chunks)))
      .on("error", reject);
  });
}

/**
 * Crop a rectangular region out of a raster. Out-of-bounds pixels become
 * transparent (0,0,0,0) so callers see a clean edge rather than wrapping.
 * @param {{width:number,height:number,data:Uint8Array}} raster
 * @param {number} x  top-left x (inclusive), raster pixel space
 * @param {number} y  top-left y (inclusive)
 * @param {number} w  crop width
 * @param {number} h  crop height
 * @returns {{width:number,height:number,data:Uint8Array}}
 */
export function cropRaster(raster, x, y, w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcX = x + col;
      const srcY = y + row;
      const dst = (row * w + col) * 4;
      if (
        srcX < 0 ||
        srcY < 0 ||
        srcX >= raster.width ||
        srcY >= raster.height
      ) {
        data[dst] = 0;
        data[dst + 1] = 0;
        data[dst + 2] = 0;
        data[dst + 3] = 0;
        continue;
      }
      const src = (srcY * raster.width + srcX) * 4;
      data[dst] = raster.data[src];
      data[dst + 1] = raster.data[src + 1];
      data[dst + 2] = raster.data[src + 2];
      data[dst + 3] = raster.data[src + 3];
    }
  }
  return { width: w, height: h, data };
}

/**
 * Convert an RGBA raster to a single-channel luminance array (0..255).
 * Uses Rec. 601 luma; alpha is treated as background (alpha 0 → 255, i.e. white).
 * @param {{width:number,height:number,data:Uint8Array}} raster
 * @returns {Uint8Array} length === width*height
 */
export function toLuminance(raster) {
  const n = raster.width * raster.height;
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = raster.data[o];
    const g = raster.data[o + 1];
    const b = raster.data[o + 2];
    const a = raster.data[o + 3];
    // Transparent pixels are background (white in the reference).
    const y = a === 0 ? 255 : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = y;
  }
  return lum;
}

/**
 * Binarize a luminance array into an ink mask. A pixel is "ink" when its
 * luminance is strictly below `threshold` (matching the reference's
 * pixelThreshold semantics: ink < threshold).
 * @param {Uint8Array} luminance
 * @param {number} threshold
 * @returns {Uint8Array} 1 = ink, 0 = background
 */
export function binarize(luminance, threshold) {
  const mask = new Uint8Array(luminance.length);
  for (let i = 0; i < luminance.length; i++) {
    mask[i] = luminance[i] < threshold ? 1 : 0;
  }
  return mask;
}

/**
 * Convert a luminance array to a soft ink-intensity array (Float32, 0..1).
 * Maps 255 (white) → 0, 0 (black) → 1, linearly across the threshold band.
 * Anti-aliased edge pixels get partial intensity, so a 1px edge difference
 * between two rasterizers no longer reads as a full miss/extra pixel.
 *
 * @param {Uint8Array} luminance
 * @param {number} threshold  luminance at/above = 0 ink; below this the
 *   intensity rises linearly to 1.0 at luminance 0.
 * @returns {Float32Array}
 */
export function softInk(luminance, threshold) {
  const out = new Float32Array(luminance.length);
  for (let i = 0; i < luminance.length; i++) {
    out[i] = luminance[i] >= threshold ? 0 : 1 - luminance[i] / threshold;
  }
  return out;
}

/**
 * Weighted Intersection-over-Union using soft ink intensities. Each pixel
 * contributes its intensity (0..1) to the intersection (min) and union (max),
 * so anti-aliased edges contribute fractionally instead of all-or-nothing.
 *
 * @param {Float32Array} refInk
 * @param {Float32Array} renderedInk
 * @returns {{iou:number,intersection:number,union:number}}
 */
export function softIou(refInk, renderedInk) {
  if (refInk.length !== renderedInk.length) {
    throw new Error("soft ink length mismatch");
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < refInk.length; i++) {
    const a = refInk[i];
    const b = renderedInk[i];
    intersection += Math.min(a, b);
    union += Math.max(a, b);
  }
  return {
    iou: union === 0 ? 1 : intersection / union,
    intersection,
    union,
  };
}

/**
 * For each pixel in `missExtra` (the symmetric difference of two masks), count
 * whether it sits within `maxDist` pixels of any ink pixel in `other`. Returns
 * the fraction that do — the "edge-shell ratio". A high ratio means the
 * disagreement pixels hug the other side's ink contour (anti-alias / sub-pixel
 * edge differences); a low ratio means they form solid blocks far from any
 * matching ink (true geometry mismatch).
 *
 * Uses a simple multi-source BFS over the 8-neighbourhood, bounded by maxDist,
 * so cost is O(pixels) rather than O(pixels * radius²).
 *
 * @param {Uint8Array} missExtra  symmetric difference mask (1 = disagreement)
 * @param {Uint8Array} other  the mask whose contour we measure distance to
 * @param {number} width
 * @param {number} height
 * @param {number} maxDist  max neighbourhood distance to consider (px)
 * @returns {{ratio:number, near:number, total:number}}
 */
export function edgeShellRatio(missExtra, other, width, height, maxDist = 2) {
  const n = width * height;
  if (missExtra.length !== n || other.length !== n) {
    throw new Error("edgeShellRatio length mismatch");
  }
  // BFS from all `other` ink pixels; record the shortest distance to any ink.
  const dist = new Int16Array(n).fill(32767);
  const queue = [];
  let head = 0;
  for (let i = 0; i < n; i++) {
    if (other[i] === 1) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  const neighbours = [
    -1,
    1,
    -width,
    width,
    -width - 1,
    -width + 1,
    width - 1,
    width + 1,
  ];
  while (head < queue.length) {
    const i = queue[head++];
    const d = dist[i];
    if (d >= maxDist) continue;
    const x = i % width;
    for (let k = 0; k < 8; k++) {
      const j = i + neighbours[k];
      if (j < 0 || j >= n) continue;
      // reject horizontal wraps
      if ((k === 0 || k === 4 || k === 6) && x === 0) continue;
      if ((k === 1 || k === 5 || k === 7) && x === width - 1) continue;
      if (dist[j] > d + 1) {
        dist[j] = d + 1;
        queue.push(j);
      }
    }
  }
  let near = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (missExtra[i] === 1) {
      total++;
      if (dist[i] <= maxDist) near++;
    }
  }
  return { ratio: total === 0 ? 0 : near / total, near, total };
}

/**
 * Compute Intersection-over-Union of two equal-length ink masks.
 * @param {Uint8Array} refMask
 * @param {Uint8Array} renderedMask
 * @returns {{iou:number,intersection:number,union:number,miss:number,extra:number}}
 *   miss = ref ink absent in render; extra = render ink absent in ref.
 */
export function iou(refMask, renderedMask) {
  if (refMask.length !== renderedMask.length) {
    throw new Error(
      `mask length mismatch: ref=${refMask.length} rendered=${renderedMask.length}`,
    );
  }
  let intersection = 0;
  let union = 0;
  let miss = 0;
  let extra = 0;
  for (let i = 0; i < refMask.length; i++) {
    const r = refMask[i] === 1;
    const d = renderedMask[i] === 1;
    if (r && d) intersection++;
    if (r || d) union++;
    if (r && !d) miss++;
    if (!r && d) extra++;
  }
  return {
    iou: union === 0 ? 1 : intersection / union,
    intersection,
    union,
    miss,
    extra,
  };
}

/**
 * Compose a 3-channel diff raster from two equal-sized ink masks.
 *   red channel   = reference-only ink (missed in render)
 *   green channel = render-only ink (extra vs reference)
 *   overlap       = mid-gray
 *   empty         = white background
 * Output is opaque RGBA.
 * @param {Uint8Array} refMask
 * @param {Uint8Array} renderedMask
 * @param {number} width
 * @param {number} height
 * @returns {{width:number,height:number,data:Uint8Array}}
 */
export function composeDiff(refMask, renderedMask, width, height) {
  if (refMask.length !== renderedMask.length) {
    throw new Error("mask length mismatch in composeDiff");
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < refMask.length; i++) {
    const o = i * 4;
    const r = refMask[i] === 1;
    const d = renderedMask[i] === 1;
    if (r && d) {
      // overlap — dark gray
      data[o] = 90;
      data[o + 1] = 90;
      data[o + 2] = 90;
      data[o + 3] = 255;
    } else if (r) {
      // missed — red
      data[o] = 220;
      data[o + 1] = 40;
      data[o + 2] = 40;
      data[o + 3] = 255;
    } else if (d) {
      // extra — green
      data[o] = 40;
      data[o + 1] = 200;
      data[o + 2] = 40;
      data[o + 3] = 255;
    } else {
      // background — white
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Render a luminance array as a grayscale RGBA raster (for side-by-side output).
 * @param {Uint8Array} luminance
 * @param {number} width
 * @param {number} height
 * @returns {{width:number,height:number,data:Uint8Array}}
 */
export function luminanceToRaster(luminance, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < luminance.length; i++) {
    const o = i * 4;
    data[o] = luminance[i];
    data[o + 1] = luminance[i];
    data[o + 2] = luminance[i];
    data[o + 3] = 255;
  }
  return { width, height, data };
}
