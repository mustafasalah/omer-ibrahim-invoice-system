"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { getCsrfToken } from "@/components/auth/client-api";
import { asMinorUnitString } from "@/domain/invoices/contracts";
import { inspectDecimalInput } from "@/domain/invoices/decimal";
import {
  calculateEditorPreview,
  createEditorState,
  draftToPlainText,
  duplicateEditorItem,
  editorDraftFingerprint,
  editorItemHasData,
  emptyEditorItem,
  moveEditorItem,
  parseInvoiceResponse,
  removeEditorItem,
  stateFromInvoice,
  toDraftInput,
  toIssueInput,
  type EditorItem,
  type InvoiceEditorState,
} from "@/domain/invoices/editor";
import { MAX_DRAFT_ITEMS, type InvoiceDraftDto, type InvoiceEditorDefaults } from "@/domain/invoices/draft";
import { formatMoney } from "@/domain/invoices/format";
import type { MessageShape } from "@/i18n/types";

type Messages = MessageShape["invoiceEditor"];
type EditorStatus = "ready" | "saving" | "saved" | "issuing" | "issued" | "validation" | "unavailable" |
  "forbidden" | "notFound" | "malformed" | "stale";
type ApiErrorBody = { error?: { code?: string; message?: string; fieldErrors?: Record<string, string>; requestId?: string } };

function newClientKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `line-${Date.now()}`;
}

function errorMessage(code: string | undefined, messages: Messages): string | undefined {
  switch (code) {
    case "INVALID_DECIMAL":
    case "DECIMAL_INCOMPLETE":
    case "DECIMAL_REQUIRED": return messages.invalidDecimal;
    case "QUANTITY_MUST_BE_POSITIVE": return messages.quantityPositive;
    case "UNIT_PRICE_MUST_BE_NON_NEGATIVE": return messages.priceNonNegative;
    case "DECIMAL_SCALE_EXCEEDED": return messages.decimalScale;
    case "MONEY_OVERFLOW": return messages.moneyOverflow;
    case "INVALID_DATE": return messages.invalidDate;
    case "DUE_DATE_BEFORE_INVOICE_DATE": return messages.dueBeforeInvoice;
    case "FUTURE_DATE_FORBIDDEN": return messages.futureForbidden;
    case "TEXT_TOO_LONG":
    case "Too big: expected string to have <=2000 characters": return messages.textTooLong;
    case "REQUIRED": return messages.required;
    case "AT_LEAST_ONE_COMPLETE_ITEM_REQUIRED": return messages.itemRequired;
    case "INVALID_INTENT": return messages.unavailable;
    default: return code;
  }
}

function initialState(defaults: InvoiceEditorDefaults, invoice: InvoiceDraftDto | null): InvoiceEditorState {
  return invoice ? stateFromInvoice(invoice) : createEditorState(defaults, "new-line-1");
}

export function InvoiceEditor({
  mode,
  defaults,
  initialInvoice,
  messages,
}: {
  mode: "create" | "edit";
  defaults: InvoiceEditorDefaults;
  initialInvoice: InvoiceDraftDto | null;
  messages: Messages;
}) {
  const router = useRouter();
  const firstState = useMemo(() => initialState(defaults, initialInvoice), [defaults, initialInvoice]);
  const [invoice, setInvoice] = useState(firstState);
  const [baseline, setBaseline] = useState(() => editorDraftFingerprint(firstState));
  const [status, setStatus] = useState<EditorStatus>("ready");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copyFallback, setCopyFallback] = useState("");
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const issueDialogRef = useRef<HTMLDivElement>(null);
  const issueButtonRef = useRef<HTMLButtonElement>(null);
  const issueRequestIdRef = useRef<string | null>(null);
  const issueInFlightRef = useRef(false);
  const focusIssueErrorsRef = useRef(false);
  const dirty = editorDraftFingerprint(invoice) !== baseline;
  const busy = status === "saving" || status === "issuing";
  const preview = useMemo(() => calculateEditorPreview(invoice.items, invoice.currency), [invoice.items, invoice.currency]);
  const displayedPreview = invoice.serverPreview ?? preview;

  const updateInvoice = useCallback((updater: (current: InvoiceEditorState) => InvoiceEditorState) => {
    setInvoice((current) => ({ ...updater(current), serverPreview: null }));
    setStatus((current) => current === "saving" || current === "issuing" ? current : "ready");
    setStatusMessage("");
    setWarnings([]);
  }, []);

  const focusFirstError = useCallback(() => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    const localErrors = { ...preview.fieldErrors };
    if (invoice.notes.length > 2_000) localErrors["invoice.notes"] = "TEXT_TOO_LONG";
    if (invoice.paymentTerms.length > 2_000) localErrors["invoice.paymentTerms"] = "TEXT_TOO_LONG";
    if (Object.keys(localErrors).length > 0) {
      setStatus("validation");
      setFieldErrors(localErrors);
      setStatusMessage(messages.validationSummary);
      focusFirstError();
      return;
    }

    setStatus("saving");
    setStatusMessage("");
    setFieldErrors({});
    setWarnings([]);
    setCopyFallback("");
    try {
      const csrf = await getCsrfToken();
      const isCreate = invoice.id === null;
      const target = isCreate ? "/api/invoices" : `/api/invoices/${encodeURIComponent(invoice.id ?? "")}`;
      const response = await fetch(target, {
        method: isCreate ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(isCreate
          ? { intent: "SAVE_DRAFT", invoice: toDraftInput(invoice) }
          : { rowVersion: invoice.rowVersion, invoice: toDraftInput(invoice) }),
      });
      const body = await response.json() as ApiErrorBody & { invoice?: unknown; warnings?: Array<{ code?: string }> };
      if (!response.ok) {
        setFieldErrors(body.error?.fieldErrors ?? {});
        setStatusMessage(body.error?.message ?? messages.unavailable);
        if (response.status === 401) { router.replace("/login"); return; }
        if (response.status === 403) setStatus("forbidden");
        else if (response.status === 404) setStatus("notFound");
        else if (response.status === 409) setStatus("stale");
        else if (response.status === 422) { setStatus("validation"); focusFirstError(); }
        else setStatus("unavailable");
        return;
      }

      const saved = parseInvoiceResponse(body.invoice);
      if (!saved || saved.invoiceStatus !== "DRAFT" || saved.isArchived) {
        setStatus("malformed");
        setStatusMessage(messages.malformed);
        return;
      }
      const next = stateFromInvoice(saved);
      setInvoice(next);
      setBaseline(editorDraftFingerprint(next));
      setWarnings((body.warnings ?? []).filter((warning) => warning.code === "FUTURE_INVOICE_DATE").map(() => messages.futureDateWarning));
      setStatus("saved");
      setStatusMessage(messages.saved.replace("{number}", saved.invoiceNumber));
      if (isCreate) {
        window.setTimeout(() => router.replace(`/invoices/${encodeURIComponent(saved.id)}/edit?saved=1`), 0);
      }
    } catch {
      setStatus("unavailable");
      setStatusMessage(messages.unavailable);
    }
  }, [busy, focusFirstError, invoice, messages, preview.fieldErrors, router]);

  const issue = useCallback(async () => {
    if (issueInFlightRef.current || busy) return;
    issueInFlightRef.current = true;
    setShowIssueConfirm(false);
    setStatus("issuing");
    setStatusMessage("");
    setFieldErrors({});
    setWarnings([]);
    setCopyFallback("");
    focusIssueErrorsRef.current = false;
    const requestId = issueRequestIdRef.current ?? newClientKey();
    issueRequestIdRef.current = requestId;
    try {
      const csrf = await getCsrfToken();
      const isCreate = invoice.id === null;
      const target = isCreate ? "/api/invoices" : `/api/invoices/${encodeURIComponent(invoice.id ?? "")}/issue`;
      const response = await fetch(target, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf, "x-request-id": requestId },
        body: JSON.stringify(isCreate
          ? { intent: "ISSUE", invoice: toIssueInput(invoice) }
          : { rowVersion: invoice.rowVersion, invoice: toIssueInput(invoice) }),
      });
      const body = await response.json() as ApiErrorBody & { invoice?: unknown; warnings?: Array<{ code?: string }> };
      if (!response.ok) {
        setFieldErrors(body.error?.fieldErrors ?? {});
        setStatusMessage(body.error?.message ?? messages.unavailable);
        if (response.status === 401) { router.replace("/login"); return; }
        if (response.status === 403) setStatus("forbidden");
        else if (response.status === 404) setStatus("notFound");
        else if (response.status === 409) setStatus("stale");
        else if (response.status === 422) { focusIssueErrorsRef.current = true; setStatus("validation"); }
        else setStatus("unavailable");
        return;
      }
      const issued = parseInvoiceResponse(body.invoice);
      if (!issued || issued.invoiceStatus !== "ISSUED" || issued.isArchived || !issued.issuedAt || !issued.printSnapshot) {
        setStatus("malformed");
        setStatusMessage(messages.malformed);
        return;
      }
      issueRequestIdRef.current = null;
      const next = stateFromInvoice(issued);
      setInvoice(next);
      setBaseline(editorDraftFingerprint(next));
      setWarnings((body.warnings ?? []).filter((warning) => warning.code === "FUTURE_INVOICE_DATE").map(() => messages.futureDateWarning));
      setStatus("issued");
      setStatusMessage(messages.issued.replace("{number}", issued.invoiceNumber));
      const editPath = `/invoices/${encodeURIComponent(issued.id)}/edit`;
      window.setTimeout(() => { router.replace(editPath); router.refresh(); }, 0);
    } catch {
      setStatus("unavailable");
      setStatusMessage(messages.issueUnknownOutcome);
    } finally {
      issueInFlightRef.current = false;
    }
  }, [busy, invoice, messages, router]);

  useEffect(() => {
    if (!focusIssueErrorsRef.current || status !== "validation") return;
    focusIssueErrorsRef.current = false;
    errorSummaryRef.current?.focus();
  }, [fieldErrors, status]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = messages.leaveWarning; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, messages.leaveWarning]);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [save]);

  useEffect(() => {
    if (!showIssueConfirm) return;
    const dialog = issueDialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowIssueConfirm(false);
        issueButtonRef.current?.focus();
      } else if (event.key === "Tab") {
        const elements = focusable();
        if (elements.length === 0) return;
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showIssueConfirm]);

  function submit(event: FormEvent) { event.preventDefault(); void save(); }
  function confirmNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm(messages.leaveWarning)) event.preventDefault();
  }
  function updateItem(index: number, field: keyof Omit<EditorItem, "clientKey">, value: string) {
    updateInvoice((current) => ({ ...current, items: current.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item) }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`invoice.items.${index}.${field}`];
      delete next[`items.${index}.${field}`];
      const key = invoice.items[index]?.clientKey;
      if (key) delete next[`invoice.itemsByClientKey.${key}.${field}`];
      if (key) delete next[`itemsByClientKey.${key}.${field}`];
      return next;
    });
  }
  function canonicalize(index: number, field: "quantity" | "unitPrice") {
    const value = invoice.items[index]?.[field] ?? "";
    const inspected = inspectDecimalInput(value, field);
    if (inspected.state === "valid") updateItem(index, field, inspected.value);
  }
  function addItem() {
    if (invoice.items.length >= MAX_DRAFT_ITEMS) { setStatusMessage(messages.maxItems); setStatus("validation"); return; }
    updateInvoice((current) => ({ ...current, items: [...current.items, emptyEditorItem(newClientKey())] }));
    requestAnimationFrame(() => document.getElementById(`item-${invoice.items.length}-productName`)?.focus());
  }
  function duplicateItem(index: number) {
    if (invoice.items.length >= MAX_DRAFT_ITEMS) { setStatusMessage(messages.maxItems); setStatus("validation"); return; }
    updateInvoice((current) => ({ ...current, items: duplicateEditorItem(current.items, index, newClientKey()) }));
  }
  function deleteItem(index: number) {
    const item = invoice.items[index];
    if (item && editorItemHasData(item) && !window.confirm(messages.removeItemConfirm)) return;
    updateInvoice((current) => ({ ...current, items: removeEditorItem(current.items, index, newClientKey()) }));
  }
  function onLastPriceKey(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Enter" && index === invoice.items.length - 1 && !event.nativeEvent.isComposing) {
      event.preventDefault(); addItem();
    }
  }
  function inputError(index: number, item: EditorItem, field: string): string | undefined {
    const code = fieldErrors[`itemsByClientKey.${item.clientKey}.${field}`]
      ?? fieldErrors[`items.${index}.${field}`]
      ?? fieldErrors[`invoice.itemsByClientKey.${item.clientKey}.${field}`]
      ?? fieldErrors[`invoice.items.${index}.${field}`]
      ?? preview.fieldErrors[`invoice.items.${index}.${field}`];
    return errorMessage(code, messages);
  }
  async function loadLatest() {
    if (!invoice.id || !window.confirm(messages.replaceConfirm)) return;
    setStatusMessage("");
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(invoice.id)}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      if (response.status === 403) { setStatus("forbidden"); return; }
      if (response.status === 404) { setStatus("notFound"); return; }
      const body = await response.json() as { invoice?: unknown };
      const latest = response.ok ? parseInvoiceResponse(body.invoice) : null;
      if (!latest || latest.invoiceStatus !== "DRAFT" || latest.isArchived) { setStatus("malformed"); return; }
      const next = stateFromInvoice(latest);
      setInvoice(next); setBaseline(editorDraftFingerprint(next)); setFieldErrors({}); setStatus("ready"); setCopyFallback("");
    } catch { setStatus("unavailable"); setStatusMessage(messages.unavailable); }
  }
  async function copyInput() {
    const text = draftToPlainText(invoice);
    try { await navigator.clipboard.writeText(text); setCopyFallback(""); setStatusMessage(messages.copied); }
    catch { setCopyFallback(text); setStatusMessage(messages.copyFallback); }
  }

  function focusField(path: string) {
    let id: string | null = null;
    if (path === "beneficiary.name" || path === "invoice.beneficiary.name") id = "beneficiary-name";
    else if (path === "invoiceDate" || path === "invoice.invoiceDate") id = "invoice-date";
    else if (path === "dueDate" || path === "invoice.dueDate") id = "due-date";
    else {
      const keyed = /^itemsByClientKey\.([^.]+)\.(.+)$/u.exec(path);
      const indexed = /^(?:invoice\.)?items\.(\d+)\.(.+)$/u.exec(path);
      const index = keyed ? invoice.items.findIndex((item) => item.clientKey === keyed[1]) : Number(indexed?.[1] ?? -1);
      const field = keyed?.[2] ?? indexed?.[2];
      if (index >= 0 && field) id = `item-${index}-${field}`;
    }
    (id ? document.getElementById(id) : document.getElementById("items-title"))?.focus();
  }

  const money = (minor: string) => formatMoney(asMinorUnitString(minor), invoice.currency);
  const topError = errorMessage(fieldErrors.invoice, messages);
  const summarizedErrors = Object.entries(fieldErrors).filter(([path]) => !path.includes("itemsByClientKey"));

  return <main className="invoice-editor-page" id="main-content" data-row-version={invoice.rowVersion ?? "unsaved"}>
    <nav className="invoice-breadcrumb" aria-label={messages.invoicesBreadcrumb}>
      <Link href="/" onClick={confirmNavigation}>{messages.dashboard}</Link><span aria-hidden="true">/</span><span>{messages.invoicesBreadcrumb}</span>
    </nav>
    <header className="invoice-editor-header">
      <div><h1>{mode === "create" ? messages.newTitle : messages.editTitle}</h1>
        <div className="invoice-editor-meta"><span className="status-badge">{invoice.invoiceStatus === "ISSUED" ? messages.issuedStatus : messages.draft}</span>
          {invoice.invoiceNumber ? <><span>{messages.invoiceNumber}: <bdi>{invoice.invoiceNumber}</bdi></span><span>{messages.rowVersion}: <bdi>{invoice.rowVersion}</bdi></span></> : <span>{messages.unsaved}</span>}
        </div></div>
    </header>

    {status === "stale" && <aside className="invoice-conflict" role="alertdialog" aria-labelledby="stale-title">
      <div><strong id="stale-title">{messages.staleTitle}</strong><p>{messages.staleDescription}</p></div>
      <div className="invoice-conflict__actions"><button type="button" onClick={() => void loadLatest()}>{messages.loadLatest}</button>
        <button type="button" className="button-secondary" onClick={() => void copyInput()}>{messages.copyInput}</button></div>
    </aside>}
    {statusMessage && status !== "stale" && <div className={status === "saved" || status === "issued" ? "invoice-notice invoice-notice--success" : "invoice-notice invoice-notice--error"} role={status === "saved" || status === "issued" ? "status" : "alert"}>{statusMessage}</div>}
    {warnings.map((warning) => <div className="invoice-notice invoice-notice--warning" role="status" key={warning}>{warning}</div>)}
    {topError && <div className="invoice-notice invoice-notice--error" role="alert">{topError}</div>}
    {status === "validation" && summarizedErrors.length > 0 && <div className="invoice-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef} aria-labelledby="invoice-error-summary-title">
      <strong id="invoice-error-summary-title">{messages.issueValidationSummary}</strong>
      <ul>{summarizedErrors.map(([path, code]) => <li key={path}><button type="button" onClick={() => focusField(path)}>{errorMessage(code, messages) ?? code}</button></li>)}</ul>
    </div>}
    {copyFallback && <label className="copy-fallback"><span>{messages.copyFallback}</span><textarea readOnly value={copyFallback} onFocus={(event) => event.currentTarget.select()} /></label>}

    <form onSubmit={submit} className="invoice-editor-form" noValidate>
      <div className="invoice-editor-main">
        <section className="invoice-section" aria-labelledby="invoice-info-title"><h2 id="invoice-info-title">{messages.invoiceInfo}</h2>
          <div className="invoice-fields invoice-fields--four">
            <label><span>{messages.invoiceDate}</span><input id="invoice-date" type="date" dir="ltr" value={invoice.invoiceDate} onChange={(event) => updateInvoice((current) => ({ ...current, invoiceDate: event.target.value }))} aria-invalid={Boolean(fieldErrors.invoiceDate ?? fieldErrors["invoice.invoiceDate"])} />{(fieldErrors.invoiceDate ?? fieldErrors["invoice.invoiceDate"]) && <small className="field-error">{errorMessage(fieldErrors.invoiceDate ?? fieldErrors["invoice.invoiceDate"], messages)}</small>}</label>
            <label><span>{messages.dueDate}</span><input id="due-date" type="date" dir="ltr" value={invoice.dueDate} onChange={(event) => updateInvoice((current) => ({ ...current, dueDate: event.target.value }))} aria-invalid={Boolean(fieldErrors.dueDate ?? fieldErrors["invoice.dueDate"])} />{(fieldErrors.dueDate ?? fieldErrors["invoice.dueDate"]) && <small className="field-error">{errorMessage(fieldErrors.dueDate ?? fieldErrors["invoice.dueDate"], messages)}</small>}</label>
            <label><span>{messages.currency}</span><input value={`${invoice.currency.code} — ${invoice.currency.symbol}`} readOnly dir="auto" /></label>
            <label><span>{messages.tax}</span><input value={messages.taxDisabled} readOnly /></label>
          </div>
        </section>

        <section className="invoice-section" aria-labelledby="beneficiary-title"><div className="invoice-section__heading"><h2 id="beneficiary-title">{messages.beneficiary}</h2><button type="button" className="button-text" onClick={() => {
          const hasData = Object.values(invoice.beneficiary).some(Boolean);
          if (hasData && !window.confirm(messages.clearBeneficiaryConfirm)) return;
          updateInvoice((current) => ({ ...current, beneficiary: { name: "", phone: "", address: "", registrationNumber: "" } }));
        }}>{messages.clearBeneficiary}</button></div>
          <div className="invoice-fields invoice-fields--two">
            {(["name", "phone", "address", "registrationNumber"] as const).map((field) => {
              const path = `beneficiary.${field}`; const fieldError = fieldErrors[path] ?? fieldErrors[`invoice.${path}`];
              return <label key={field}><span>{{ name: messages.beneficiaryName, phone: messages.phone, address: messages.address, registrationNumber: messages.registrationNumber }[field]}</span>
                <input id={`beneficiary-${field}`} dir={field === "phone" || field === "registrationNumber" ? "ltr" : undefined}
                  value={invoice.beneficiary[field]} aria-invalid={Boolean(fieldError)} onChange={(event) => updateInvoice((current) => ({ ...current, beneficiary: { ...current.beneficiary, [field]: event.target.value } }))} />
                {fieldError && <small className="field-error">{errorMessage(fieldError, messages)}</small>}</label>;
            })}
          </div>
        </section>

        <section className="invoice-section invoice-items-section" aria-labelledby="items-title"><div className="invoice-section__heading"><div><h2 id="items-title" tabIndex={-1}>{messages.items}</h2><p>{messages.incompleteHint}</p>{fieldErrors.items && <small className="field-error">{errorMessage(fieldErrors.items, messages)}</small>}</div><button type="button" onClick={addItem} disabled={invoice.items.length >= MAX_DRAFT_ITEMS || busy}>+ {messages.addItem}</button></div>
          <div className="invoice-items" role="list">
            {invoice.items.map((item, index) => {
              const productError = inputError(index, item, "productName");
              const quantityError = inputError(index, item, "quantity"); const priceError = inputError(index, item, "unitPrice");
              const isIncomplete = editorItemHasData(item) && (!item.productName.trim() || !item.quantity || !item.unitPrice) && !quantityError && !priceError;
              return <article className="invoice-item" role="listitem" key={item.clientKey} aria-labelledby={`item-${index}-title`}>
                <div className="invoice-item__heading"><h3 id={`item-${index}-title`}>{messages.item} <bdi>{index + 1}</bdi></h3><div className="invoice-item__tools">
                  <button type="button" title={messages.moveUp} aria-label={`${messages.moveUp} ${index + 1}`} disabled={index === 0} onClick={() => updateInvoice((current) => ({ ...current, items: moveEditorItem(current.items, index, -1) }))}>↑</button>
                  <button type="button" title={messages.moveDown} aria-label={`${messages.moveDown} ${index + 1}`} disabled={index === invoice.items.length - 1} onClick={() => updateInvoice((current) => ({ ...current, items: moveEditorItem(current.items, index, 1) }))}>↓</button>
                  <button type="button" onClick={() => duplicateItem(index)}>{messages.duplicate}</button><button type="button" className="button-danger-text" onClick={() => deleteItem(index)}>{messages.remove}</button>
                </div></div>
                <div className="invoice-item__fields">
                  <label className="invoice-item__name"><span>{messages.productName}</span><input id={`item-${index}-productName`} value={item.productName} onChange={(event) => updateItem(index, "productName", event.target.value)} maxLength={250} aria-invalid={Boolean(productError)} />{productError && <small className="field-error">{productError}</small>}</label>
                  <label className="invoice-item__description"><span>{messages.description}</span><input id={`item-${index}-description`} value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} maxLength={500} /></label>
                  <label><span>{messages.unit}</span><input id={`item-${index}-unit`} value={item.unit} onChange={(event) => updateItem(index, "unit", event.target.value)} maxLength={50} /></label>
                  <label><span>{messages.quantity}</span><input id={`item-${index}-quantity`} value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} onBlur={() => canonicalize(index, "quantity")} inputMode="decimal" dir="ltr" aria-invalid={Boolean(quantityError)} />{quantityError && <small className="field-error">{quantityError}</small>}</label>
                  <label><span>{messages.unitPrice}</span><input id={`item-${index}-unitPrice`} value={item.unitPrice} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} onBlur={() => canonicalize(index, "unitPrice")} onKeyDown={(event) => onLastPriceKey(event, index)} inputMode="decimal" dir="ltr" aria-invalid={Boolean(priceError)} />{priceError && <small className="field-error">{priceError}</small>}</label>
                  <label><span>{messages.lineTotal}</span><output className="money-output" dir="ltr">{money(displayedPreview.lineTotals[item.clientKey] ?? "0")}</output></label>
                </div>{isIncomplete && <p className="invoice-item__hint">{messages.incompleteHint}</p>}
              </article>;
            })}
          </div>
        </section>

        <section className="invoice-section" aria-labelledby="notes-title"><h2 id="notes-title">{messages.notesAndTerms}</h2><div className="invoice-fields invoice-fields--two">
          <label><span>{messages.notes}</span><textarea value={invoice.notes} onChange={(event) => updateInvoice((current) => ({ ...current, notes: event.target.value }))} aria-invalid={invoice.notes.length > 2_000 || Boolean(fieldErrors["invoice.notes"])} /><small>{messages.remainingCharacters.replace("{count}", String(Math.max(0, 2_000 - invoice.notes.length)))}</small>{invoice.notes.length > 2_000 && <small className="field-error">{messages.textTooLong}</small>}</label>
          <label><span>{messages.paymentTerms}</span><textarea value={invoice.paymentTerms} onChange={(event) => updateInvoice((current) => ({ ...current, paymentTerms: event.target.value }))} aria-invalid={invoice.paymentTerms.length > 2_000 || Boolean(fieldErrors["invoice.paymentTerms"])} /><small>{messages.remainingCharacters.replace("{count}", String(Math.max(0, 2_000 - invoice.paymentTerms.length)))}</small>{invoice.paymentTerms.length > 2_000 && <small className="field-error">{messages.textTooLong}</small>}</label>
        </div></section>
      </div>

      <aside className="invoice-summary" aria-labelledby="summary-title"><h2 id="summary-title">{messages.summary}</h2><dl><div><dt>{messages.subtotal}</dt><dd dir="ltr">{money(displayedPreview.subtotalMinor)}</dd></div><div className="invoice-summary__total"><dt>{messages.grandTotal}</dt><dd dir="ltr">{money(displayedPreview.grandTotalMinor)}</dd></div></dl><p>{messages.previewNotice}</p></aside>
      <div className="invoice-save-bar"><span aria-live="polite">{dirty ? messages.unsaved : status === "saved" || status === "issued" ? statusMessage : ""}</span>
        <div className="invoice-save-bar__actions"><button type="submit" className="button-secondary" disabled={busy || status === "forbidden" || status === "notFound" || status === "malformed"}>{status === "saving" ? messages.saving : messages.saveDraft}</button>
          <button type="button" ref={issueButtonRef} disabled={busy || status === "forbidden" || status === "notFound" || status === "malformed"} onClick={() => setShowIssueConfirm(true)}>{status === "issuing" ? messages.issuing : messages.issueInvoice}</button></div></div>
    </form>
    {showIssueConfirm && <div className="invoice-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowIssueConfirm(false); issueButtonRef.current?.focus(); } }}>
      <div className="invoice-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title" aria-describedby="issue-dialog-description" ref={issueDialogRef}>
        <h2 id="issue-dialog-title">{messages.issueConfirmTitle}</h2><p id="issue-dialog-description">{messages.issueConfirmDescription}</p>
        <div className="invoice-dialog__actions"><button type="button" className="button-secondary" onClick={() => { setShowIssueConfirm(false); issueButtonRef.current?.focus(); }}>{messages.cancelIssue}</button>
          <button type="button" onClick={() => void issue()}>{messages.confirmIssue}</button></div>
      </div>
    </div>}
  </main>;
}
