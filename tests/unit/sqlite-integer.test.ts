import { describe, expect, it } from "vitest";
import {
  assertSqliteInteger,
  SQLITE_INTEGER_MAX,
  SQLITE_INTEGER_MIN,
} from "@/server/db/sqlite-integer";

describe("SQLite integer bounds", () => {
  it("accepts both signed 64-bit boundaries", () => {
    expect(assertSqliteInteger(SQLITE_INTEGER_MIN)).toBe(SQLITE_INTEGER_MIN);
    expect(assertSqliteInteger(SQLITE_INTEGER_MAX)).toBe(SQLITE_INTEGER_MAX);
  });

  it("rejects overflow before database binding", () => {
    expect(() => assertSqliteInteger(SQLITE_INTEGER_MAX + 1n)).toThrow(RangeError);
    expect(() => assertSqliteInteger(SQLITE_INTEGER_MIN - 1n)).toThrow(RangeError);
  });
});
