import { createHmac, randomBytes } from "node:crypto";

// Two independent counters per pair bound memory without evicting active limits.
// A collision can throttle an unrelated pair only if both buckets are saturated.
export class LoginAttempts {
  private readonly secret = randomBytes(32);
  private readonly counts = new Uint8Array(2 * 65536);
  private readonly expires = new Float64Array(2 * 65536);

  constructor(private readonly threshold = 12) {}

  forKey(key: string) {
    const digest = createHmac("sha256", this.secret).update(key).digest();
    const slots = [digest.readUInt16BE(0), 65536 + digest.readUInt16BE(2)];
    return {
      limited: (now = Date.now()) =>
        slots.every(
          (slot) =>
            this.expires[slot]! > now && this.counts[slot]! >= this.threshold,
        ),
      failed: (now = Date.now()) => {
        for (const slot of slots) {
          if (this.expires[slot]! <= now) {
            this.expires[slot] = now + 300_000;
            this.counts[slot] = 0;
          }
          this.counts[slot] = Math.min(this.threshold, this.counts[slot]! + 1);
        }
      },
    };
  }
}
