import "server-only";

export const SQLITE_INTEGER_MIN = -(1n << 63n);
export const SQLITE_INTEGER_MAX = (1n << 63n) - 1n;

export function assertSqliteInteger(value: bigint): bigint {
  if (value < SQLITE_INTEGER_MIN || value > SQLITE_INTEGER_MAX) {
    throw new RangeError("Integer is outside SQLite signed 64-bit range.");
  }

  return value;
}
