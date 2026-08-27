import "server-only";

import { hash, hashSync, verify, type Algorithm, type Options } from "@node-rs/argon2";

export const argon2idOptions: Readonly<Options> = Object.freeze({
  // @node-rs/argon2 exposes Algorithm as a const enum, which isolatedModules cannot access.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const dummyPasswordHash = hashSync("oims-timing-equalization-password", argon2idOptions);

export function hashPassword(password: string): Promise<string> {
  return hash(password, argon2idOptions);
}

export async function verifyPassword(passwordHash: string | undefined, password: string): Promise<boolean> {
  const hashToVerify = passwordHash ?? dummyPasswordHash;

  try {
    const valid = await verify(hashToVerify, password);
    return passwordHash ? valid : false;
  } catch {
    return false;
  }
}
