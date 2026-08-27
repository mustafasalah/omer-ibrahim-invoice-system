import { describe, expect, it } from "vitest";
import { getCapabilitiesForRole, roleHasCapability } from "@/domain/auth/capabilities";

describe("role capability mapping", () => {
  it("grants shared invoice capabilities to both roles", () => {
    expect(roleHasCapability("ADMIN", "invoice.create")).toBe(true);
    expect(roleHasCapability("EMPLOYEE", "invoice.create")).toBe(true);
    expect(getCapabilitiesForRole("EMPLOYEE")).toContain("dashboard.read");
  });

  it("keeps administrative capabilities away from employees", () => {
    expect(roleHasCapability("ADMIN", "settings.manage")).toBe(true);
    expect(roleHasCapability("EMPLOYEE", "settings.manage")).toBe(false);
    expect(roleHasCapability("EMPLOYEE", "refund.create")).toBe(false);
  });
});
