import "server-only";
import { randomInt } from "crypto";

const PW_LETTERS = "abcdefghjkmnpqrstuvwxyz"; // no i/l/o — easy to read out over WhatsApp

// Passwords the admin hands out (customer accounts, delivery partner logins):
// GF-abcd-1234.
export function tempPassword() {
  let letters = "";
  for (let i = 0; i < 4; i++) letters += PW_LETTERS[randomInt(PW_LETTERS.length)];
  return `GF-${letters}-${String(randomInt(10000)).padStart(4, "0")}`;
}
