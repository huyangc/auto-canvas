import { expect, it } from "vitest";
import { LoginAttempts } from "./login-attempts.js";
it("retains active limits as new keys arrive and releases them after the window", () => {
  const attempts = new LoginAttempts();
  const blocked = attempts.forKey("192.0.2.1/a00000001");
  for (let n = 0; n < 12; n++) blocked.failed(1000);
  for (let n = 0; n < 5000; n++) attempts.forKey("192.0.2.2/" + n).failed(1001);
  expect(blocked.limited(1002)).toBe(true);
  expect(attempts.forKey("192.0.2.3/a00000002").limited(1002)).toBe(false);
  expect(blocked.limited(301000)).toBe(false);
});
