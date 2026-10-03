import QRCode from "qrcode";
import type { jsPDF } from "jspdf";

/**
 * UPI deep-link payloads and QR generation for the member portal and printed
 * bills. Every member of a society pays into the society's single UPI ID
 * (VPA); the QR is "dynamic" per member — the payee note carries the flat so
 * the office can match bank statements to members without a gateway.
 *
 * The canvas-based generator keeps everything synchronous after the one-time
 * font/text preload, so PDF, print and Word export flows can call it inline.
 */

/** Build the flat tag embedded in the payee note. */
function flatTag(flat?: string, code?: string): string {
  const tag = (flat || code || "").trim();
  // Keep it QR-friendly: uppercase, no separators that confuse apps.
  return tag.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
}

/**
 * Per-member UPI deep link. Standard `upi://pay` URI accepted by GPay,
 * PhonePe, Paytm and BHIM. The note tags the flat so the office can match
 * the payment; the amount is deliberately left off so the member can enter
 * exactly what they want to pay.
 */
export function memberUpiUri(input: {
  payeeName: string;
  vpa: string;
  flat?: string;
  code?: string;
}): string {
  const note = `Maint ${flatTag(input.flat, input.code)}`.trim();
  const params = new URLSearchParams({
    pa: input.vpa.trim(),
    pn: input.payeeName.trim().slice(0, 40),
    tn: note,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * A deep link with a fixed amount — used when a bill's exact total is known
 * (bill PDF QR). Amount is rounded to two decimals, paise format.
 */
export function amountUpiUri(
  baseUri: string,
  amount: number,
): string {
  const amt = Math.round(amount * 100) / 100;
  const joiner = baseUri.includes("?") ? "&" : "?";
  return `${baseUri}${joiner}am=${amt.toFixed(2)}`;
}

/** Text payload of an existing QR data URL (used by tests/exports). */
export async function qrDataUrl(payload: string, px = 220): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: px,
    color: { dark: "#111827", light: "#FFFFFF" },
  });
}

/** Render a payload to a canvas (member portal card). Draws the caller's
 *  clearCanvas background first; the canvas keeps the given CSS pixels. */
export async function qrToCanvas(
  payload: string,
  canvas: HTMLCanvasElement,
  px = 220,
): Promise<void> {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: px,
    color: { dark: "#111827", light: "#FFFFFF" },
  });
}

/* --------------------------- sync (PDF/print) path -------------------------- */

type Matrix = boolean[][];

/**
 * Image cache keyed by the exact UPI payload. Batch exports preload a QR per
 * bill (each bill's payload embeds its own amount), so the cache MUST hold
 * every payload — a single-slot cache would leave only the last bill's QR
 * drawable when the batch HTML is finally built.
 */
const imageCache = new Map<string, HTMLImageElement>();
const IMAGE_CACHE_MAX = 500;
let preloadPromise: Promise<void> | null = null;

async function payloadImage(payload: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(payload);
  if (hit) return hit;
  const dataUrl = await qrDataUrl(payload, 264);
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  // Soft cap: drop the oldest entry when the cache grows past the limit.
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(payload, img);
  return img;
}

/**
 * One-time preload of the QR image for the given payload. Call this before
 * any batch PDF/print run so the synchronous draw calls always hit the cache.
 */
export function preloadQrImage(payload: string): Promise<void> {
  preloadPromise = (preloadPromise ?? Promise.resolve()).then(() =>
    payloadImage(payload).then(
      () => undefined,
      () => undefined,
    ),
  );
  return preloadPromise;
}

/**
 * Draw the QR synchronously onto a jsPDF page (or any 2D canvas context at
 * (x, y) scaled to `size`). Requires preloadQrImage() for this payload to
 * have been awaited earlier; falls back to a blank placeholder otherwise.
 */
export function drawQrImage(
  target: CanvasRenderingContext2D | jsPDF,
  payload: string,
  x: number,
  y: number,
  size: number,
): void {
  const img = imageCache.get(payload);
  if (!img) return;
  if (typeof (target as jsPDF).addImage === "function") {
    (target as jsPDF).addImage(
      img,
      "PNG",
      x,
      y,
      size,
      size,
      undefined,
      "FAST",
    );
  } else {
    const ctx = target as CanvasRenderingContext2D;
    ctx.drawImage(img, x, y, size, size);
  }
}

/**
 * Synchronous QR matrix for print/Word HTML flows: dark-module boolean grid
 * with a one-module quiet zone, ready for table/canvas rendering.
 */
export function qrMatrix(payload: string): Matrix {
  // Byte mode covers the ASCII upi:// URI, so no toSJIS callback is needed.
  // The module bits live in data (row-major 0/1 bytes) — reading them
  // directly keeps this synchronous and type-safe across qrcode versions.
  const m = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules;
  const size = m.size;
  const grid: Matrix = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(m.data[r * size + c] === 1);
    grid.push(row);
  }
  return grid;
}

/** Render a payload to a PNG data URL synchronously from a cached image. */
export function cachedQrDataUrl(payload: string): string | null {
  return imageCache.get(payload)?.src ?? null;
}
