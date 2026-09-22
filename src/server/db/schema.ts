import "server-only";

import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { assertSqliteInteger } from "./sqlite-integer";

const nocaseText = customType<{ data: string }>({
  dataType() {
    return "text COLLATE NOCASE";
  },
});

const minorUnit = customType<{ data: bigint; driverData: bigint | number }>({
  dataType() {
    return "integer";
  },
  fromDriver(value) {
    return typeof value === "bigint" ? value : BigInt(value);
  },
  toDriver(value) {
    return assertSqliteInteger(value);
  },
});

const restrictedReference = { onDelete: "restrict", onUpdate: "cascade" } as const;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: nocaseText("username").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["ADMIN", "EMPLOYEE"] }).notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: text("locked_until"),
    lastLoginAt: text("last_login_at"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").references((): AnySQLiteColumn => users.id, restrictedReference),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references((): AnySQLiteColumn => users.id, restrictedReference),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    index("users_active_role_idx").on(table.isActive, table.role),
    check("users_username_not_blank", sql`length(trim(${table.username})) > 0`),
    check("users_display_name_not_blank", sql`length(trim(${table.displayName})) > 0`),
    check("users_role_valid", sql`${table.role} in ('ADMIN', 'EMPLOYEE')`),
    check("users_is_active_boolean", sql`${table.isActive} in (0, 1)`),
    check("users_must_change_password_boolean", sql`${table.mustChangePassword} in (0, 1)`),
    check("users_failed_login_non_negative", sql`${table.failedLoginCount} >= 0`),
    check("users_row_version_positive", sql`${table.rowVersion} >= 1`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, restrictedReference),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    absoluteExpiresAt: text("absolute_expires_at").notNull(),
    revokedAt: text("revoked_at"),
    clientLabel: text("client_label"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_revoked_idx").on(table.userId, table.revokedAt),
    index("sessions_expires_at_idx").on(table.expiresAt),
    check("sessions_token_hash_not_blank", sql`length(${table.tokenHash}) > 0`),
  ],
);

export const invoiceIdempotencyRecords = sqliteTable(
  "invoice_idempotency_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, restrictedReference),
    operation: text("operation").notNull(),
    keyHash: text("key_hash").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_idempotency_user_operation_key_unique")
      .on(table.userId, table.operation, table.keyHash),
    index("invoice_idempotency_expires_idx").on(table.expiresAt, table.id),
    check(
      "invoice_idempotency_operation_valid",
      sql`length(trim(${table.operation})) between 1 and 64`,
    ),
    check(
      "invoice_idempotency_key_hash_valid",
      sql`length(${table.keyHash}) = 64 and ${table.keyHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "invoice_idempotency_request_fingerprint_valid",
      sql`length(${table.requestFingerprint}) = 64 and ${table.requestFingerprint} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "invoice_idempotency_response_status_valid",
      sql`${table.responseStatus} between 100 and 599`,
    ),
    check("invoice_idempotency_response_json_valid", sql`json_valid(${table.responseJson})`),
    check("invoice_idempotency_expiry_valid", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["COMPANY_LOGO", "STAMP", "SIGNATURE", "DEALER_LOGO"],
    }).notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    widthPx: integer("width_px").notNull(),
    heightPx: integer("height_px").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, restrictedReference),
  },
  (table) => [
    uniqueIndex("media_assets_relative_path_unique").on(table.relativePath),
    index("media_assets_kind_active_idx").on(table.kind, table.isActive),
    check(
      "media_assets_kind_valid",
      sql`${table.kind} in ('COMPANY_LOGO', 'STAMP', 'SIGNATURE', 'DEALER_LOGO')`,
    ),
    check(
      "media_assets_mime_type_valid",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check("media_assets_relative_path_only", sql`${table.relativePath} not like '/%'`),
    check("media_assets_sha256_length", sql`length(${table.sha256}) = 64`),
    check("media_assets_size_positive", sql`${table.sizeBytes} > 0`),
    check("media_assets_width_positive", sql`${table.widthPx} > 0`),
    check("media_assets_height_positive", sql`${table.heightPx} > 0`),
    check("media_assets_is_active_boolean", sql`${table.isActive} in (0, 1)`),
  ],
);

export const appSettings = sqliteTable(
  "app_settings",
  {
    id: text("id").primaryKey(),
    companyNameAr: text("company_name_ar").notNull(),
    companyNameEn: text("company_name_en").notNull(),
    address: text("address"),
    phonesJson: text("phones_json").notNull().default("[]"),
    email: text("email"),
    registrationNumber: text("registration_number"),
    currencyCode: text("currency_code").notNull(),
    currencySymbolAr: text("currency_symbol_ar").notNull(),
    currencyDecimals: integer("currency_decimals").notNull(),
    taxEnabled: integer("tax_enabled", { mode: "boolean" }).notNull().default(false),
    defaultTaxRateBps: integer("default_tax_rate_bps").notNull().default(0),
    invoiceNumberPrefix: text("invoice_number_prefix").notNull(),
    invoiceNumberPattern: text("invoice_number_pattern").notNull(),
    sequenceStart: integer("sequence_start").notNull(),
    sequenceResetPolicy: text("sequence_reset_policy", {
      enum: ["NEVER", "YEARLY"],
    }).notNull(),
    defaultPaymentTerms: text("default_payment_terms"),
    footerText: text("footer_text"),
    dateDisplayFormat: text("date_display_format", {
      enum: ["DD/MM/YYYY", "YYYY-MM-DD"],
    }).notNull(),
    paperFormat: text("paper_format", { enum: ["A4", "A5"] }).notNull(),
    timezone: text("timezone").notNull(),
    lanAccessEnabled: integer("lan_access_enabled", { mode: "boolean" }).notNull().default(false),
    sessionIdleMinutes: integer("session_idle_minutes").notNull(),
    sessionAbsoluteHours: integer("session_absolute_hours").notNull(),
    companyLogoAssetId: text("company_logo_asset_id").references(
      () => mediaAssets.id,
      restrictedReference,
    ),
    stampAssetId: text("stamp_asset_id").references(() => mediaAssets.id, restrictedReference),
    signatureAssetId: text("signature_asset_id").references(
      () => mediaAssets.id,
      restrictedReference,
    ),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, restrictedReference),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    check("app_settings_singleton", sql`${table.id} = 'default'`),
    check("app_settings_currency_code_length", sql`length(${table.currencyCode}) = 3`),
    check("app_settings_currency_decimals_range", sql`${table.currencyDecimals} between 0 and 3`),
    check("app_settings_tax_enabled_boolean", sql`${table.taxEnabled} in (0, 1)`),
    check("app_settings_tax_rate_range", sql`${table.defaultTaxRateBps} between 0 and 10000`),
    check("app_settings_prefix_length", sql`length(${table.invoiceNumberPrefix}) between 1 and 20`),
    check("app_settings_pattern_length", sql`length(${table.invoiceNumberPattern}) between 1 and 100`),
    check("app_settings_sequence_start_positive", sql`${table.sequenceStart} >= 1`),
    check(
      "app_settings_reset_policy_valid",
      sql`${table.sequenceResetPolicy} in ('NEVER', 'YEARLY')`,
    ),
    check(
      "app_settings_date_format_valid",
      sql`${table.dateDisplayFormat} in ('DD/MM/YYYY', 'YYYY-MM-DD')`,
    ),
    check("app_settings_paper_format_valid", sql`${table.paperFormat} in ('A4', 'A5')`),
    check("app_settings_lan_access_boolean", sql`${table.lanAccessEnabled} in (0, 1)`),
    check("app_settings_idle_minutes_range", sql`${table.sessionIdleMinutes} between 5 and 1440`),
    check("app_settings_absolute_hours_range", sql`${table.sessionAbsoluteHours} between 1 and 720`),
    check("app_settings_row_version_positive", sql`${table.rowVersion} >= 1`),
  ],
);

export const invoiceSequences = sqliteTable(
  "invoice_sequences",
  {
    sequenceKey: text("sequence_key").primaryKey(),
    lastValue: integer("last_value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("invoice_sequences_key_not_blank", sql`length(trim(${table.sequenceKey})) > 0`),
    check("invoice_sequences_last_value_non_negative", sql`${table.lastValue} >= 0`),
  ],
);

export const dealerLogos = sqliteTable(
  "dealer_logos",
  {
    id: text("id").primaryKey(),
    mediaAssetId: text("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, restrictedReference),
    sortOrder: integer("sort_order").notNull(),
    label: text("label"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("dealer_logos_media_asset_unique").on(table.mediaAssetId),
    uniqueIndex("dealer_logos_sort_order_unique").on(table.sortOrder),
    check("dealer_logos_sort_order_range", sql`${table.sortOrder} between 0 and 4`),
  ],
);

export const beneficiaries = sqliteTable(
  "beneficiaries",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    phone: text("phone"),
    address: text("address"),
    registrationNumber: text("registration_number"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, restrictedReference),
  },
  (table) => [
    index("beneficiaries_normalized_name_idx").on(table.normalizedName),
    index("beneficiaries_active_last_used_idx").on(table.isActive, table.lastUsedAt),
    check("beneficiaries_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check("beneficiaries_name_length", sql`length(${table.name}) <= 200`),
    check("beneficiaries_normalized_name_not_blank", sql`length(${table.normalizedName}) > 0`),
    check("beneficiaries_is_active_boolean", sql`${table.isActive} in (0, 1)`),
    check("beneficiaries_use_count_non_negative", sql`${table.useCount} >= 0`),
  ],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    unit: text("unit"),
    lastUnitPriceDecimal: text("last_unit_price_decimal"),
    lastCurrencyCode: text("last_currency_code"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, restrictedReference),
  },
  (table) => [
    index("products_normalized_name_idx").on(table.normalizedName),
    index("products_active_last_used_idx").on(table.isActive, table.lastUsedAt),
    check("products_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check("products_name_length", sql`length(${table.name}) <= 250`),
    check("products_description_length", sql`${table.description} is null or length(${table.description}) <= 500`),
    check("products_unit_length", sql`${table.unit} is null or length(${table.unit}) <= 50`),
    check("products_currency_code_length", sql`${table.lastCurrencyCode} is null or length(${table.lastCurrencyCode}) = 3`),
    check("products_is_active_boolean", sql`${table.isActive} in (0, 1)`),
    check("products_use_count_non_negative", sql`${table.useCount} >= 0`),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceStatus: text("invoice_status", {
      enum: ["DRAFT", "ISSUED", "CANCELLED"],
    })
      .notNull()
      .default("DRAFT"),
    paymentStatus: text("payment_status", {
      enum: [
        "UNPAID",
        "PARTIALLY_PAID",
        "FULLY_PAID",
        "PARTIALLY_REFUNDED",
        "FULLY_REFUNDED",
      ],
    })
      .notNull()
      .default("UNPAID"),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date"),
    beneficiaryId: text("beneficiary_id").references(() => beneficiaries.id, restrictedReference),
    beneficiaryName: text("beneficiary_name"),
    beneficiaryPhone: text("beneficiary_phone"),
    beneficiaryAddress: text("beneficiary_address"),
    beneficiaryRegistrationNumber: text("beneficiary_registration_number"),
    currencyCode: text("currency_code").notNull(),
    currencySymbol: text("currency_symbol").notNull(),
    currencyDecimals: integer("currency_decimals").notNull(),
    taxEnabled: integer("tax_enabled", { mode: "boolean" }).notNull().default(false),
    invoiceDiscountKind: text("invoice_discount_kind", {
      enum: ["NONE", "PERCENT", "FIXED"],
    })
      .notNull()
      .default("NONE"),
    invoiceDiscountRateBps: integer("invoice_discount_rate_bps"),
    invoiceDiscountInputMinor: minorUnit("invoice_discount_input_minor"),
    subtotalMinor: minorUnit("subtotal_minor").notNull().default(sql`0`),
    lineDiscountsMinor: minorUnit("line_discounts_minor").notNull().default(sql`0`),
    invoiceDiscountMinor: minorUnit("invoice_discount_minor").notNull().default(sql`0`),
    discountTotalMinor: minorUnit("discount_total_minor").notNull().default(sql`0`),
    taxableTotalMinor: minorUnit("taxable_total_minor").notNull().default(sql`0`),
    taxTotalMinor: minorUnit("tax_total_minor").notNull().default(sql`0`),
    grandTotalMinor: minorUnit("grand_total_minor").notNull().default(sql`0`),
    grossPaidMinor: minorUnit("gross_paid_minor").notNull().default(sql`0`),
    refundedTotalMinor: minorUnit("refunded_total_minor").notNull().default(sql`0`),
    netCollectedMinor: minorUnit("net_collected_minor").notNull().default(sql`0`),
    remainingMinor: minorUnit("remaining_minor").notNull().default(sql`0`),
    notes: text("notes"),
    paymentTerms: text("payment_terms"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, restrictedReference),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, restrictedReference),
    issuedAt: text("issued_at"),
    issuedBy: text("issued_by").references(() => users.id, restrictedReference),
    cancelledAt: text("cancelled_at"),
    cancelledBy: text("cancelled_by").references(() => users.id, restrictedReference),
    cancellationReason: text("cancellation_reason"),
    archivedAt: text("archived_at"),
    archivedBy: text("archived_by").references(() => users.id, restrictedReference),
    copiedFromInvoiceId: text("copied_from_invoice_id").references(
      (): AnySQLiteColumn => invoices.id,
      restrictedReference,
    ),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("invoices_invoice_number_unique").on(table.invoiceNumber),
    index("invoices_date_number_idx").on(table.invoiceDate, table.invoiceNumber),
    index("invoices_status_payment_archive_idx").on(
      table.invoiceStatus,
      table.paymentStatus,
      table.isArchived,
    ),
    index("invoices_beneficiary_name_idx").on(table.beneficiaryName),
    index("invoices_created_by_idx").on(table.createdBy),
    index("invoices_due_date_idx").on(table.dueDate),
    index("invoices_grand_total_idx").on(table.grandTotalMinor),
    index("invoices_updated_at_idx").on(table.updatedAt),
    check("invoices_status_valid", sql`${table.invoiceStatus} in ('DRAFT', 'ISSUED', 'CANCELLED')`),
    check(
      "invoices_payment_status_valid",
      sql`${table.paymentStatus} in ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED')`,
    ),
    check("invoices_is_archived_boolean", sql`${table.isArchived} in (0, 1)`),
    check("invoices_date_format", sql`${table.invoiceDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("invoices_due_date_order", sql`${table.dueDate} is null or ${table.dueDate} >= ${table.invoiceDate}`),
    check("invoices_currency_code_length", sql`length(${table.currencyCode}) = 3`),
    check("invoices_currency_decimals_range", sql`${table.currencyDecimals} between 0 and 3`),
    check("invoices_tax_enabled_boolean", sql`${table.taxEnabled} in (0, 1)`),
    check(
      "invoices_discount_kind_valid",
      sql`${table.invoiceDiscountKind} in ('NONE', 'PERCENT', 'FIXED')`,
    ),
    check(
      "invoices_discount_rate_range",
      sql`${table.invoiceDiscountRateBps} is null or ${table.invoiceDiscountRateBps} between 0 and 10000`,
    ),
    check("invoices_subtotal_non_negative", sql`${table.subtotalMinor} >= 0`),
    check("invoices_line_discounts_non_negative", sql`${table.lineDiscountsMinor} >= 0`),
    check("invoices_invoice_discount_non_negative", sql`${table.invoiceDiscountMinor} >= 0`),
    check("invoices_discount_total_non_negative", sql`${table.discountTotalMinor} >= 0`),
    check("invoices_taxable_total_non_negative", sql`${table.taxableTotalMinor} >= 0`),
    check("invoices_tax_total_non_negative", sql`${table.taxTotalMinor} >= 0`),
    check("invoices_grand_total_non_negative", sql`${table.grandTotalMinor} >= 0`),
    check("invoices_gross_paid_non_negative", sql`${table.grossPaidMinor} >= 0`),
    check("invoices_refunded_total_non_negative", sql`${table.refundedTotalMinor} >= 0`),
    check("invoices_net_collected_non_negative", sql`${table.netCollectedMinor} >= 0`),
    check("invoices_remaining_non_negative", sql`${table.remainingMinor} >= 0`),
    check("invoices_notes_length", sql`${table.notes} is null or length(${table.notes}) <= 2000`),
    check(
      "invoices_payment_terms_length",
      sql`${table.paymentTerms} is null or length(${table.paymentTerms}) <= 2000`,
    ),
    check("invoices_row_version_positive", sql`${table.rowVersion} >= 1`),
    check(
      "invoices_archive_metadata_consistent",
      sql`(${table.isArchived} = 0 and ${table.archivedAt} is null and ${table.archivedBy} is null) or (${table.isArchived} = 1 and ${table.archivedAt} is not null and ${table.archivedBy} is not null)`,
    ),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, restrictedReference),
    productId: text("product_id").references(() => products.id, restrictedReference),
    sortOrder: integer("sort_order").notNull(),
    productName: text("product_name"),
    description: text("description"),
    unit: text("unit"),
    quantityDecimal: text("quantity_decimal"),
    unitPriceDecimal: text("unit_price_decimal"),
    baseMinor: minorUnit("base_minor").notNull().default(sql`0`),
    discountKind: text("discount_kind", { enum: ["NONE", "PERCENT", "FIXED"] })
      .notNull()
      .default("NONE"),
    discountRateBps: integer("discount_rate_bps"),
    discountInputMinor: minorUnit("discount_input_minor"),
    discountMinor: minorUnit("discount_minor").notNull().default(sql`0`),
    allocatedInvoiceDiscountMinor: minorUnit("allocated_invoice_discount_minor")
      .notNull()
      .default(sql`0`),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxableMinor: minorUnit("taxable_minor").notNull().default(sql`0`),
    taxMinor: minorUnit("tax_minor").notNull().default(sql`0`),
    lineTotalMinor: minorUnit("line_total_minor").notNull().default(sql`0`),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_items_invoice_sort_unique").on(table.invoiceId, table.sortOrder),
    index("invoice_items_product_name_idx").on(table.productName),
    index("invoice_items_product_id_idx").on(table.productId),
    check("invoice_items_sort_order_non_negative", sql`${table.sortOrder} >= 0`),
    check("invoice_items_product_name_length", sql`${table.productName} is null or length(${table.productName}) <= 250`),
    check("invoice_items_description_length", sql`${table.description} is null or length(${table.description}) <= 500`),
    check("invoice_items_unit_length", sql`${table.unit} is null or length(${table.unit}) <= 50`),
    check(
      "invoice_items_discount_kind_valid",
      sql`${table.discountKind} in ('NONE', 'PERCENT', 'FIXED')`,
    ),
    check(
      "invoice_items_discount_rate_range",
      sql`${table.discountRateBps} is null or ${table.discountRateBps} between 0 and 10000`,
    ),
    check("invoice_items_base_non_negative", sql`${table.baseMinor} >= 0`),
    check("invoice_items_discount_non_negative", sql`${table.discountMinor} >= 0`),
    check(
      "invoice_items_allocated_discount_non_negative",
      sql`${table.allocatedInvoiceDiscountMinor} >= 0`,
    ),
    check("invoice_items_tax_rate_range", sql`${table.taxRateBps} between 0 and 10000`),
    check("invoice_items_taxable_non_negative", sql`${table.taxableMinor} >= 0`),
    check("invoice_items_tax_non_negative", sql`${table.taxMinor} >= 0`),
    check("invoice_items_line_total_non_negative", sql`${table.lineTotalMinor} >= 0`),
  ],
);

export const invoicePrintSnapshots = sqliteTable(
  "invoice_print_snapshots",
  {
    invoiceId: text("invoice_id")
      .primaryKey()
      .references(() => invoices.id, restrictedReference),
    companyNameAr: text("company_name_ar").notNull(),
    companyNameEn: text("company_name_en").notNull(),
    address: text("address"),
    phonesJson: text("phones_json").notNull(),
    email: text("email"),
    registrationNumber: text("registration_number"),
    footerText: text("footer_text"),
    companyLogoAssetId: text("company_logo_asset_id").references(
      () => mediaAssets.id,
      restrictedReference,
    ),
    stampAssetId: text("stamp_asset_id").references(() => mediaAssets.id, restrictedReference),
    signatureAssetId: text("signature_asset_id").references(
      () => mediaAssets.id,
      restrictedReference,
    ),
    paperFormat: text("paper_format", { enum: ["A4", "A5"] }).notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    check(
      "invoice_print_snapshots_paper_format_valid",
      sql`${table.paperFormat} in ('A4', 'A5')`,
    ),
  ],
);

export const invoiceDealerLogos = sqliteTable(
  "invoice_dealer_logos",
  {
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, restrictedReference),
    mediaAssetId: text("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, restrictedReference),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({
      name: "invoice_dealer_logos_pk",
      columns: [table.invoiceId, table.sortOrder],
    }),
    check("invoice_dealer_logos_sort_order_range", sql`${table.sortOrder} between 0 and 4`),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, restrictedReference),
    actorDisplayName: text("actor_display_name"),
    invoiceId: text("invoice_id").references(() => invoices.id, restrictedReference),
    invoiceNumber: text("invoice_number"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    changesJson: text("changes_json"),
    createdAt: text("created_at").notNull(),
    requestId: text("request_id").notNull(),
  },
  (table) => [
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_event_type_idx").on(table.eventType),
    index("audit_logs_actor_user_idx").on(table.actorUserId),
    index("audit_logs_invoice_idx").on(table.invoiceId),
    check("audit_logs_event_type_not_blank", sql`length(trim(${table.eventType})) > 0`),
    check("audit_logs_summary_not_blank", sql`length(trim(${table.summary})) > 0`),
    check("audit_logs_request_id_not_blank", sql`length(trim(${table.requestId})) > 0`),
  ],
);

export const schema = {
  appSettings,
  auditLogs,
  beneficiaries,
  dealerLogos,
  invoiceDealerLogos,
  invoiceIdempotencyRecords,
  invoiceItems,
  invoicePrintSnapshots,
  invoiceSequences,
  invoices,
  mediaAssets,
  products,
  sessions,
  users,
};
