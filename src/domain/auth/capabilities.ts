export const roles = ["ADMIN", "EMPLOYEE"] as const;

export type Role = (typeof roles)[number];

export const capabilities = [
  "password.change",
  "dashboard.read",
  "invoice.read",
  "invoice.create",
  "invoice.edit_draft",
  "invoice.issue",
  "invoice.edit_issued",
  "invoice.cancel",
  "invoice.archive",
  "invoice.copy",
  "invoice.print",
  "payment.create",
  "refund.create",
  "financial_transaction.void",
  "suggestion.delete",
  "report.read",
  "report.print",
  "settings.manage",
  "media.manage",
  "backup.create",
  "backup.restore",
  "user.manage",
  "audit.read",
] as const;

export type Capability = (typeof capabilities)[number];

const employeeCapabilities = [
  "password.change",
  "dashboard.read",
  "invoice.read",
  "invoice.create",
  "invoice.edit_draft",
  "invoice.issue",
  "invoice.archive",
  "invoice.copy",
  "invoice.print",
  "payment.create",
  "suggestion.delete",
  "report.read",
  "report.print",
] as const satisfies readonly Capability[];

const adminCapabilities = capabilities;

export const roleCapabilities = {
  ADMIN: adminCapabilities,
  EMPLOYEE: employeeCapabilities,
} as const satisfies Record<Role, readonly Capability[]>;

export function getCapabilitiesForRole(role: Role): readonly Capability[] {
  return roleCapabilities[role];
}

export function roleHasCapability(role: Role, capability: Capability): boolean {
  return (roleCapabilities[role] as readonly Capability[]).includes(capability);
}
