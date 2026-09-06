import Link from "next/link";
import { redirect } from "next/navigation";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import type { InvoiceEditorDefaults } from "@/domain/invoices/draft";
import { getMessages } from "@/i18n";
import { optionalPageSession } from "@/server/auth/page-session";
import { AppError } from "@/server/http/errors";
import { getInvoiceDraft } from "@/server/invoices/service";

export const dynamic = "force-dynamic";

function StatePage({ message, back }: { message: string; back: string }) {
  return <main className="invoice-state-page" id="main-content"><div role="alert">{message}</div><Link href="/">{back}</Link></main>;
}

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await optionalPageSession();
  if (!session) redirect("/login");
  const messages = getMessages();
  if (!session.user.capabilities.includes("invoice.edit_draft")) {
    return <StatePage message={messages.invoiceEditor.forbidden} back={messages.invoiceEditor.backDashboard} />;
  }

  const { id } = await params;
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(id)) {
    return <StatePage message={messages.invoiceEditor.notFound} back={messages.invoiceEditor.backDashboard} />;
  }
  let invoice;
  try { invoice = getInvoiceDraft(id); }
  catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return <StatePage message={messages.invoiceEditor.notFound} back={messages.invoiceEditor.backDashboard} />;
    }
    return <StatePage message={messages.invoiceEditor.unavailable} back={messages.invoiceEditor.backDashboard} />;
  }
  if (invoice.isArchived) return <StatePage message={messages.invoiceEditor.blockedArchived} back={messages.invoiceEditor.backDashboard} />;
  if (invoice.invoiceStatus === "ISSUED") return <StatePage message={messages.invoiceEditor.blockedIssued} back={messages.invoiceEditor.backDashboard} />;
  if (invoice.invoiceStatus === "CANCELLED") return <StatePage message={messages.invoiceEditor.blockedCancelled} back={messages.invoiceEditor.backDashboard} />;
  if (invoice.invoiceStatus !== "DRAFT") return <StatePage message={messages.invoiceEditor.malformed} back={messages.invoiceEditor.backDashboard} />;

  const defaults: InvoiceEditorDefaults = {
    invoiceDate: invoice.invoiceDate,
    currency: invoice.currency,
    taxEnabled: false,
    paymentTerms: invoice.paymentTerms,
  };
  return <InvoiceEditor mode="edit" defaults={defaults} initialInvoice={invoice} messages={messages.invoiceEditor} />;
}
