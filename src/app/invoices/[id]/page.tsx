import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  formatCalendarDate,
  formatStoredMoney,
  formatStoredQuantity,
  formatStoredUnitPrice,
  formatUtcTimestamp,
  invoiceStatusKey,
  paymentStatusKey,
} from "@/domain/invoices/details";
import type { InvoiceDraftDto } from "@/domain/invoices/draft";
import { getMessages } from "@/i18n";
import type { MessageShape } from "@/i18n/types";
import { optionalPageSession } from "@/server/auth/page-session";
import { AppError } from "@/server/http/errors";
import { getInvoiceDraft } from "@/server/invoices/service";

export const dynamic = "force-dynamic";

type DetailsMessages = MessageShape["invoiceDetails"];

function StatePage({ title, message, retryHref, messages }: {
  title: string;
  message: string;
  retryHref?: string;
  messages: DetailsMessages;
}) {
  return <main className="invoice-state-page" id="main-content">
    <h1>{title}</h1>
    <div role="alert">{message}</div>
    <nav className="invoice-state-actions" aria-label={messages.availableActions}>
      {retryHref && <a href={retryHref}>{messages.retry}</a>}
      <Link href="/">{messages.backDashboard}</Link>
    </nav>
  </main>;
}

function Value({ children, ltr = false }: { children: ReactNode; ltr?: boolean }) {
  return children === null || children === ""
    ? <span className="invoice-detail-empty">—</span>
    : ltr ? <bdi dir="ltr">{children}</bdi> : <>{children}</>;
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`invoice-detail-badge invoice-detail-badge--${tone}`}>
    <span aria-hidden="true">●</span><span>{label}</span>
  </span>;
}

function FinancialCards({ invoice, messages }: { invoice: InvoiceDraftDto; messages: DetailsMessages }) {
  const money = (value: string) => formatStoredMoney(value, invoice.currency);
  const cards = [
    [messages.grandTotal, invoice.totals.grandTotalMinor, "grand"],
    [messages.grossPaid, invoice.totals.grossPaidMinor, "paid"],
    [messages.refunded, invoice.totals.refundedTotalMinor, "refunded"],
    [messages.netCollected, invoice.totals.netCollectedMinor, "net"],
    [messages.remaining, invoice.totals.remainingMinor, "remaining"],
  ] as const;
  return <section aria-labelledby="financial-summary-title">
    <h2 id="financial-summary-title" className="invoice-detail-section-title">{messages.financialSummary}</h2>
    <dl className="invoice-detail-financials">
      {cards.map(([label, value, tone]) => <div className={`invoice-detail-financial invoice-detail-financial--${tone}`} key={label}>
        <dt>{label}</dt><dd><bdi dir="ltr">{money(value)}</bdi></dd>
      </div>)}
    </dl>
  </section>;
}

export default async function InvoiceDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await optionalPageSession();
  if (!session) redirect("/login");
  const messages = getMessages().invoiceDetails;
  if (!session.user.capabilities.includes("invoice.read")) {
    return <StatePage title={messages.title} message={messages.forbidden} messages={messages} />;
  }

  const { id } = await params;
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(id)) {
    return <StatePage title={messages.title} message={messages.notFound} messages={messages} />;
  }

  let invoice: InvoiceDraftDto;
  try {
    invoice = getInvoiceDraft(id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return <StatePage title={messages.title} message={messages.notFound} messages={messages} />;
    }
    return <StatePage title={messages.title} message={messages.unavailable}
      retryHref={`/invoices/${encodeURIComponent(id)}`} messages={messages} />;
  }

  const invoiceStatus = invoiceStatusKey(invoice.invoiceStatus);
  const paymentStatus = paymentStatusKey(invoice.paymentStatus);
  const money = (value: string) => formatStoredMoney(value, invoice.currency);
  const timestamp = (value: string) => `${formatUtcTimestamp(value)} ${messages.utc}`;

  return <main className="invoice-details-page" id="main-content" data-invoice-status={invoice.invoiceStatus}>
    <nav className="invoice-breadcrumb" aria-label={messages.breadcrumb}>
      <Link href="/">{messages.dashboard}</Link><span aria-hidden="true">/</span><span>{messages.title}</span>
    </nav>

    <header className="invoice-details-header">
      <div>
        <p>{messages.invoiceNumber}</p>
        <h1><bdi dir="ltr">{invoice.invoiceNumber}</bdi></h1>
        <div className="invoice-detail-badges" aria-label={messages.statusesLabel}>
          <StatusBadge label={messages.invoiceStatuses[invoiceStatus]} tone={invoiceStatus} />
          <StatusBadge label={messages.paymentStatuses[paymentStatus]} tone={paymentStatus} />
          <StatusBadge label={invoice.isArchived ? messages.archived : messages.notArchived}
            tone={invoice.isArchived ? "archived" : "active"} />
        </div>
      </div>
      <nav className="invoice-detail-actions" aria-label={messages.availableActions}>
        {invoice.invoiceStatus === "DRAFT" && !invoice.isArchived &&
          session.user.capabilities.includes("invoice.edit_draft") &&
          <Link href={`/invoices/${encodeURIComponent(invoice.id)}/edit`}>{messages.editDraft}</Link>}
        <Link className="button-secondary" href="/">{messages.backDashboard}</Link>
      </nav>
    </header>

    <FinancialCards invoice={invoice} messages={messages} />

    <div className="invoice-details-layout">
      <div className="invoice-details-main">
        <section className="invoice-detail-section" aria-labelledby="beneficiary-details-title">
          <h2 id="beneficiary-details-title">{messages.beneficiary}</h2>
          <dl className="invoice-detail-grid">
            <div><dt>{messages.beneficiaryName}</dt><dd><Value>{invoice.beneficiary.name}</Value></dd></div>
            <div><dt>{messages.phone}</dt><dd><Value ltr>{invoice.beneficiary.phone}</Value></dd></div>
            <div><dt>{messages.address}</dt><dd><Value>{invoice.beneficiary.address}</Value></dd></div>
            <div><dt>{messages.registrationNumber}</dt><dd><Value ltr>{invoice.beneficiary.registrationNumber}</Value></dd></div>
          </dl>
        </section>

        <section className="invoice-detail-section" aria-labelledby="invoice-items-title">
          <div className="invoice-detail-section-heading">
            <h2 id="invoice-items-title">{messages.items}</h2>
            <span>{messages.itemCount}: <bdi dir="ltr">{invoice.items.length}</bdi></span>
          </div>
          {invoice.items.length === 0 ? <p className="invoice-detail-empty">{messages.noItems}</p> :
            <ol className="invoice-detail-items">
              {invoice.items.map((item, index) => <li key={item.id} data-sort-order={item.sortOrder}>
                <div className="invoice-detail-item-heading">
                  <span className="invoice-detail-item-number" aria-hidden="true">{index + 1}</span>
                  <div><h3><Value>{item.productName}</Value></h3>
                    {item.description && <p>{item.description}</p>}</div>
                </div>
                <dl className="invoice-detail-item-values">
                  <div><dt>{messages.unit}</dt><dd><Value>{item.unit}</Value></dd></div>
                  <div><dt>{messages.quantity}</dt><dd><Value ltr>{formatStoredQuantity(item.quantity)}</Value></dd></div>
                  <div><dt>{messages.unitPrice}</dt><dd><span className="invoice-detail-unit-price" dir="ltr">
                    <Value ltr>{formatStoredUnitPrice(item.unitPrice, invoice.currency)}</Value>
                  </span></dd></div>
                  <div><dt>{messages.lineTotal}</dt><dd><bdi dir="ltr">{money(item.lineTotalMinor)}</bdi></dd></div>
                </dl>
              </li>)}
            </ol>}
        </section>

        <section className="invoice-detail-section" aria-labelledby="notes-terms-title">
          <h2 id="notes-terms-title">{messages.notesAndTerms}</h2>
          <dl className="invoice-detail-texts">
            <div><dt>{messages.paymentTerms}</dt><dd><Value>{invoice.paymentTerms}</Value></dd></div>
            <div><dt>{messages.notes}</dt><dd><Value>{invoice.notes}</Value></dd></div>
          </dl>
        </section>
      </div>

      <aside className="invoice-detail-section invoice-detail-metadata" aria-labelledby="metadata-title">
        <h2 id="metadata-title">{messages.metadata}</h2>
        <dl>
          <div><dt>{messages.invoiceDate}</dt><dd><time dir="ltr" dateTime={invoice.invoiceDate}>{formatCalendarDate(invoice.invoiceDate)}</time></dd></div>
          <div><dt>{messages.dueDate}</dt><dd>{invoice.dueDate
            ? <time dir="ltr" dateTime={invoice.dueDate}>{formatCalendarDate(invoice.dueDate)}</time>
            : <span className="invoice-detail-empty">—</span>}</dd></div>
          <div><dt>{messages.currencySnapshot}</dt><dd><bdi dir="ltr">{invoice.currency.code} · {invoice.currency.symbol} · {invoice.currency.decimals}</bdi></dd></div>
          <div><dt>{messages.createdBy}</dt><dd>{invoice.createdBy.displayName}</dd></div>
          <div><dt>{messages.createdAt}</dt><dd><time dir="ltr" dateTime={invoice.createdAt}>{timestamp(invoice.createdAt)}</time></dd></div>
          <div><dt>{messages.updatedBy}</dt><dd>{invoice.updatedBy.displayName}</dd></div>
          <div><dt>{messages.updatedAt}</dt><dd><time dir="ltr" dateTime={invoice.updatedAt}>{timestamp(invoice.updatedAt)}</time></dd></div>
          {invoice.issuedAt && <div><dt>{messages.issuedAt}</dt><dd><time dir="ltr" dateTime={invoice.issuedAt}>{timestamp(invoice.issuedAt)}</time></dd></div>}
          {invoice.issuedBy && <div><dt>{messages.issuedBy}</dt><dd>{invoice.issuedBy.displayName}</dd></div>}
          {invoice.sourceInvoice && <div><dt>{messages.sourceInvoice}</dt><dd>
            <Link href={`/invoices/${encodeURIComponent(invoice.sourceInvoice.id)}`}><bdi dir="ltr">{invoice.sourceInvoice.invoiceNumber}</bdi></Link>
          </dd></div>}
          <div><dt>{messages.rowVersion}</dt><dd><bdi dir="ltr">{invoice.rowVersion}</bdi></dd></div>
        </dl>
        {invoice.printSnapshot && <div className="invoice-detail-snapshot">
          <h3>{messages.companySnapshot}</h3>
          <dl>
            <div><dt>{messages.companyNameAr}</dt><dd><Value>{invoice.printSnapshot.companyNameAr}</Value></dd></div>
            <div><dt>{messages.companyNameEn}</dt><dd lang="en"><Value ltr>{invoice.printSnapshot.companyNameEn}</Value></dd></div>
            <div><dt>{messages.address}</dt><dd><Value>{invoice.printSnapshot.address}</Value></dd></div>
            <div><dt>{messages.phones}</dt><dd>{invoice.printSnapshot.phones.length > 0
              ? <span className="invoice-detail-snapshot-phones">{invoice.printSnapshot.phones.map((phone, index) =>
                <bdi dir="ltr" key={`${index}-${phone}`}>{phone}</bdi>)}</span>
              : <span className="invoice-detail-empty">—</span>}</dd></div>
            <div><dt>{messages.email}</dt><dd><Value ltr>{invoice.printSnapshot.email}</Value></dd></div>
            <div><dt>{messages.registrationNumber}</dt><dd><Value ltr>{invoice.printSnapshot.registrationNumber}</Value></dd></div>
            <div><dt>{messages.footerText}</dt><dd><Value>{invoice.printSnapshot.footerText}</Value></dd></div>
            <div><dt>{messages.paperFormat}</dt><dd><bdi dir="ltr">{invoice.printSnapshot.paperFormat}</bdi></dd></div>
            <div><dt>{messages.snapshotCapturedAt}</dt><dd><time dir="ltr" dateTime={invoice.printSnapshot.capturedAt}>{timestamp(invoice.printSnapshot.capturedAt)}</time></dd></div>
          </dl>
        </div>}
      </aside>
    </div>
  </main>;
}
