/**
 * Human-readable error extraction for Convex mutation failures.
 *
 * Convex wraps thrown `Error`s as `ConvexError` instances whose user-facing
 * text sits in `.data` (a string for our business guards); raw `err.message`
 * alone shows the opaque transport wrapper ("[CONVEX M(fn)…] Server Error").
 * `convexErrorText` returns the office-readable message either way, so
 * toasts can always show the real reason a save was rejected.
 */

/** A Convex client error: user payload in `.data`, generic text in `.message`. */
interface ConvexLikeError {
  data?: unknown;
  message?: string;
}

export function convexErrorText(err: unknown, fallback: string): string {
  let data: unknown;
  if (typeof err === "object" && err !== null && "data" in err) {
    data = (err as ConvexLikeError).data;
  }
  // Our guards throw plain strings — use them verbatim.
  if (typeof data === "string" && data.trim()) return data;
  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof (data as ConvexLikeError).message === "string"
  ) {
    const m = (data as ConvexLikeError).message!;
    if (m.trim()) return m;
  }
  if (err instanceof Error && err.message?.trim()) {
    // Real JS errors (network, auth) still surface their own text — but strip
    // the Convex transport wrapper the SDK prepends: "[CONVEX M(fn)] [...] Server Error...".
    return err.message
      .replace(/^\[CONVEX [^\]]+\]\s*/i, "")
      .replace(/^Server Error\s*/i, "")
      .replace(/^Called by client\s*:?\s*/i, "")
      .trim() || fallback;
  }
  return fallback;
}
