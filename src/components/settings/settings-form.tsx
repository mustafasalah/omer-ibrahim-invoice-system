"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { EditableSettings, InvoiceNumberPreview, SettingsResponse } from "@/domain/settings/contracts";
import { formatInvoiceNumber } from "@/domain/settings/numbering";
import type { MessageShape } from "@/i18n/types";
import { getCsrfToken } from "@/components/auth/client-api";

type Messages = MessageShape["settings"];
type FormState = EditableSettings & { rowVersion: number; absoluteHours: 12; phonesText: string };

function fromResponse(response: SettingsResponse): FormState {
  return { ...response.settings, session: { idleMinutes: response.settings.session.idleMinutes },
    rowVersion: response.settings.rowVersion, absoluteHours: response.settings.session.absoluteHours,
    phonesText: response.settings.company.phones.join("\n") };
}

export function SettingsForm({ messages }: { messages: Messages }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [baseline, setBaseline] = useState("");
  const [serverPreview, setServerPreview] = useState<InvoiceNumberPreview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "saved" | "error" | "forbidden" | "stale">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (!active) return;
      if (response.status === 403) { setStatus("forbidden"); return; }
      if (!response.ok) throw new Error("LOAD_FAILED");
      const body = await response.json() as SettingsResponse;
      const next = fromResponse(body);
      setForm(next); setBaseline(JSON.stringify(next)); setServerPreview(body.preview); setStatus("ready");
    }).catch(() => { if (active) { setErrorMessage(messages.unavailable); setStatus("error"); } });
    return () => { active = false; };
  }, [messages.unavailable]);

  const dirty = form !== null && JSON.stringify(form) !== baseline;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = messages.leaveWarning; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, messages.leaveWarning]);

  const preview = useMemo(() => {
    if (!form || !serverPreview) return null;
    try { return formatInvoiceNumber({ ...form.numbering, nextValue: BigInt(serverPreview.nextValue),
      at: new Date(), timezone: form.regional.timezone }); }
    catch { return null; }
  }, [form, serverPreview]);

  if (status === "loading") return <main className="settings-page" id="main-content"><p>{messages.loading}</p></main>;
  if (status === "forbidden") return <main className="settings-page" id="main-content"><div className="settings-alert" role="alert">{messages.forbidden}</div></main>;
  if (!form) return <main className="settings-page" id="main-content"><div className="settings-alert" role="alert">{errorMessage || messages.unavailable}</div></main>;
  const currentForm = form;

  const update = <K extends keyof EditableSettings>(section: K, value: EditableSettings[K]) =>
    setForm((current) => current ? { ...current, [section]: value } : current);
  const inputError = (path: string) => fieldErrors[`settings.${path}`] ?? fieldErrors[path];
  const field = (label: string, path: string, value: string | number, onChange: (value: string) => void,
    options: { type?: string; required?: boolean; min?: number; max?: number } = {}) => (
    <label className="settings-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)}
      type={options.type} required={options.required} min={options.min} max={options.max}
      aria-invalid={Boolean(inputError(path))} />{inputError(path) && <small className="field-error">{inputError(path)}</small>}</label>
  );

  async function submit(event: FormEvent) {
    event.preventDefault(); setStatus("saving"); setFieldErrors({}); setErrorMessage("");
    try {
      const csrf = await getCsrfToken();
      const response = await fetch("/api/settings", { method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ rowVersion: currentForm.rowVersion, settings: {
          company: { ...currentForm.company, phones: currentForm.phonesText.split(/\r?\n/u).map((phone) => phone.trim()).filter(Boolean) },
          currency: currentForm.currency, numbering: currentForm.numbering, regional: currentForm.regional,
          session: currentForm.session, defaultPaymentTerms: currentForm.defaultPaymentTerms, footerText: currentForm.footerText,
        } }) });
      if (!response.ok) {
        const body = await response.json() as { error?: { code?: string; message?: string; fieldErrors?: Record<string, string> } };
        setFieldErrors(body.error?.fieldErrors ?? {});
        if (response.status === 409) { setStatus("stale"); setErrorMessage(messages.stale); }
        else if (response.status === 403) { setStatus("forbidden"); }
        else { setStatus("error"); setErrorMessage(body.error?.message ?? messages.validationSummary); }
        return;
      }
      const body = await response.json() as SettingsResponse;
      const next = fromResponse(body); setForm(next); setBaseline(JSON.stringify(next));
      setServerPreview(body.preview); setStatus("saved");
    } catch { setErrorMessage(messages.unavailable); setStatus("error"); }
  }

  return <main className="settings-page" id="main-content">
    <header className="settings-header"><div><Link href="/">{messages.back}</Link><h1>{messages.title}</h1><p>{messages.description}</p></div></header>
    {(status === "error" || status === "stale") && <div className="settings-alert" role="alert">{errorMessage || messages.validationSummary}</div>}
    {status === "saved" && <div className="settings-success" role="status">{messages.saved}</div>}
    <form className="settings-form" onSubmit={submit}>
      <section><h2>{messages.company}</h2><div className="settings-grid">
        {field(messages.companyNameAr, "company.nameAr", form.company.nameAr, (v) => update("company", { ...form.company, nameAr: v }), { required: true })}
        {field(messages.companyNameEn, "company.nameEn", form.company.nameEn, (v) => update("company", { ...form.company, nameEn: v }), { required: true })}
        {field(messages.address, "company.address", form.company.address ?? "", (v) => update("company", { ...form.company, address: v || null }))}
        <label className="settings-field"><span>{messages.phones}</span><textarea value={form.phonesText}
          aria-invalid={Boolean(inputError("company.phones"))}
          onChange={(e) => setForm({ ...form, phonesText: e.target.value })} />
          {inputError("company.phones") && <small className="field-error">{inputError("company.phones")}</small>}</label>
        {field(messages.email, "company.email", form.company.email ?? "", (v) => update("company", { ...form.company, email: v || null }), { type: "email" })}
        {field(messages.registrationNumber, "company.registrationNumber", form.company.registrationNumber ?? "", (v) => update("company", { ...form.company, registrationNumber: v || null }))}
      </div></section>
      <section><h2>{messages.currency}</h2><div className="settings-grid settings-grid--three">
        {field(messages.currencyCode, "currency.code", form.currency.code, (v) => update("currency", { ...form.currency, code: v.toUpperCase() }), { required: true })}
        {field(messages.currencySymbol, "currency.symbolAr", form.currency.symbolAr, (v) => update("currency", { ...form.currency, symbolAr: v }), { required: true })}
        {field(messages.currencyDecimals, "currency.decimals", form.currency.decimals, (v) => update("currency", { ...form.currency, decimals: Number(v) }), { type: "number", min: 0, max: 3 })}
      </div></section>
      <section><h2>{messages.numbering}</h2><p className="settings-notice">{messages.futureOnly}</p><div className="settings-grid">
        {field(messages.prefix, "numbering.prefix", form.numbering.prefix, (v) => update("numbering", { ...form.numbering, prefix: v }), { required: true })}
        {field(messages.pattern, "numbering.pattern", form.numbering.pattern, (v) => update("numbering", { ...form.numbering, pattern: v }), { required: true })}
        {field(messages.sequenceStart, "numbering.sequenceStart", form.numbering.sequenceStart, (v) => update("numbering", { ...form.numbering, sequenceStart: Number(v) }), { type: "number", min: 1 })}
        <label className="settings-field"><span>{messages.resetPolicy}</span><select value={form.numbering.resetPolicy} onChange={(e) => update("numbering", { ...form.numbering, resetPolicy: e.target.value as "NEVER" | "YEARLY" })}><option value="YEARLY">{messages.yearly}</option><option value="NEVER">{messages.never}</option></select></label>
      </div><div className="number-preview"><span>{messages.preview}</span><strong dir="ltr">{preview?.invoiceNumber ?? "—"}</strong></div></section>
      <section><h2>{messages.regional}</h2><div className="settings-grid settings-grid--three">
        <label className="settings-field"><span>{messages.dateFormat}</span><select value={form.regional.dateDisplayFormat} onChange={(e) => update("regional", { ...form.regional, dateDisplayFormat: e.target.value as "DD/MM/YYYY" | "YYYY-MM-DD" })}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select></label>
        {field(messages.timezone, "regional.timezone", form.regional.timezone, (v) => update("regional", { ...form.regional, timezone: v }), { required: true })}
        <label className="settings-field"><span>{messages.paperFormat}</span><input value="A4" readOnly /></label>
      </div></section>
      <section><h2>{messages.session}</h2><p className="settings-notice">{messages.newSessionsOnly}</p><div className="settings-grid">
        {field(messages.idleMinutes, "session.idleMinutes", form.session.idleMinutes, (v) => update("session", { idleMinutes: Number(v) }), { type: "number", min: 5, max: 1440 })}
        <label className="settings-field"><span>{messages.absoluteHours}</span><input value={`${form.absoluteHours}`} readOnly /></label>
      </div></section>
      <section><div className="settings-grid">
        <label className="settings-field"><span>{messages.paymentTerms}</span><textarea value={form.defaultPaymentTerms ?? ""}
          aria-invalid={Boolean(inputError("defaultPaymentTerms"))}
          onChange={(e) => update("defaultPaymentTerms", e.target.value || null)} />
          {inputError("defaultPaymentTerms") && <small className="field-error">{inputError("defaultPaymentTerms")}</small>}</label>
        <label className="settings-field"><span>{messages.footerText}</span><textarea value={form.footerText ?? ""}
          aria-invalid={Boolean(inputError("footerText"))}
          onChange={(e) => update("footerText", e.target.value || null)} />
          {inputError("footerText") && <small className="field-error">{inputError("footerText")}</small>}</label>
      </div></section>
      <div className="settings-actions"><button type="submit" disabled={status === "saving" || !dirty}>{status === "saving" ? messages.saving : messages.save}</button></div>
    </form>
  </main>;
}
