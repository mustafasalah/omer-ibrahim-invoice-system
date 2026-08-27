import { arMessages } from "./locales/ar";
import { enMessages } from "./locales/en";
import type { Locale, MessageShape } from "./types";

const catalogs: Record<Locale, MessageShape> = {
  ar: arMessages,
  en: enMessages,
};

export const defaultLocale: Locale = "ar";

export function getMessages(locale: Locale = defaultLocale): MessageShape {
  return catalogs[locale];
}

export function getDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
