import "server-only";
import { after } from "next/server";

// Work the admin shouldn't wait for — customer messages (Expo push goes to
// exp.host, a round trip out of India) — runs after the response is sent
// (next/server `after`). Outside a request (where `after` isn't available) it
// just runs now. Failures are logged, never thrown: a message that didn't go
// must not undo what the office did.
export function background(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (e) {
      console.error("background task failed:", e);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
