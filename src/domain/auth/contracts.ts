import type { Capability, Role } from "./capabilities";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  capabilities: readonly Capability[];
};

export type BootstrapStatus = {
  bootstrapRequired: boolean;
};

export type BootstrapAdminInput = {
  username: string;
  displayName: string;
  password: string;
  passwordConfirmation: string;
};

export type LoginInput = {
  username: string;
  password: string;
};
