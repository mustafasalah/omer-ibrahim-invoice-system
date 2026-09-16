"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}

export function GlobalShortcuts() {
  const pathname = usePathname();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat
        || !event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.key.toLowerCase() !== "n"
        || pathname === "/login"
        || pathname === "/setup"
        || pathname === "/invoices/new"
        || isEditableTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      // A full local navigation deliberately preserves beforeunload protection
      // when an editor contains unsaved work.
      const target = new URL("/invoices/new", window.location.origin);
      window.location.assign(target.href);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname]);

  return null;
}
