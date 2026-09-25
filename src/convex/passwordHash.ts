import { Scrypt } from "lucia";

/**
 * Same algorithm/config as the Convex Auth Password provider (Scrypt from
 * Lucia), so hashes produced by sign-up verify here and hashes we produce are
 * accepted by sign-in.
 */
export function hashPassword(password: string) {
  return new Scrypt().hash(password);
}

export function verifyPassword(password: string, hash: string) {
  return new Scrypt().verify(hash, password);
}
