import type { arMessages } from "./locales/ar";

type Widen<T> = T extends string
  ? string
  : T extends Record<string, unknown>
    ? { [Key in keyof T]: Widen<T[Key]> }
    : T;

export type MessageShape = Widen<typeof arMessages>;
export type Locale = "ar" | "en";
