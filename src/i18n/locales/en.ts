import type { MessageShape } from "../types";

export const enMessages = {
  metadata: {
    title: "Invoice Management System",
    description: "Local sales invoice management system",
  },
  accessibility: {
    skipToContent: "Skip to main content",
  },
  home: {
    eyebrow: "Omer Ibrahim Medical Supplies",
    title: "The technical foundation is ready",
    description:
      "The Arabic application shell and local database are configured. Authentication and invoice management are not enabled yet.",
    healthLabel: "Check service health",
    foundationTitle: "Project foundation",
    foundationDescription:
      "RTL Arabic UI, centralized translations, typed runtime configuration, and a consistent error contract.",
    databaseTitle: "Database",
    databaseDescription:
      "Local SQLite with migrations, integrity constraints, safe transactions, and append-only audit records.",
    scopeTitle: "Current scope",
    scopeDescription:
      "This is a foundation screen only; authentication and the invoice editor belong to later implementation steps.",
  },
  errors: {
    internal: "The request could not be completed.",
    serviceUnavailable: "The local service is not ready.",
    validation: "Check the submitted data.",
    conflict: "The operation conflicts with a newer change.",
    databaseBusy: "The database is temporarily busy. Try again.",
    notFound: "The requested item was not found.",
  },
} as const satisfies MessageShape;
