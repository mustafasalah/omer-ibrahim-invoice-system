export const SETTINGS_ID = "default" as const;
export const SESSION_ABSOLUTE_HOURS = 12 as const;

export type SequenceResetPolicy = "NEVER" | "YEARLY";
export type DateDisplayFormat = "DD/MM/YYYY" | "YYYY-MM-DD";

export type EditableSettings = {
  company: {
    nameAr: string;
    nameEn: string;
    address: string | null;
    phones: string[];
    email: string | null;
    registrationNumber: string | null;
  };
  currency: {
    code: string;
    symbolAr: string;
    decimals: number;
  };
  numbering: {
    prefix: string;
    pattern: string;
    sequenceStart: number;
    resetPolicy: SequenceResetPolicy;
  };
  regional: {
    dateDisplayFormat: DateDisplayFormat;
    timezone: string;
    paperFormat: "A4";
  };
  session: {
    idleMinutes: number;
  };
  defaultPaymentTerms: string | null;
  footerText: string | null;
};

export type SettingsDto = EditableSettings & {
  rowVersion: number;
  session: EditableSettings["session"] & { absoluteHours: typeof SESSION_ABSOLUTE_HOURS };
  updatedAt: string;
};

export type InvoiceNumberPreview = {
  invoiceNumber: string;
  sequenceKey: string;
  nextValue: string;
  year: number;
};

export type SettingsResponse = {
  settings: SettingsDto;
  preview: InvoiceNumberPreview;
  requestId: string;
};

