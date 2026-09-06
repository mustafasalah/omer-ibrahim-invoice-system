import Link from "next/link";
import { redirect } from "next/navigation";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { getMessages } from "@/i18n";
import { optionalPageSession } from "@/server/auth/page-session";
import { getInvoiceEditorDefaults } from "@/server/invoices/editor-defaults";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const session = await optionalPageSession();
  if (!session) redirect("/login");
  const messages = getMessages();
  if (!session.user.capabilities.includes("invoice.create")) {
    return <main className="invoice-state-page" id="main-content"><div role="alert">{messages.invoiceEditor.forbidden}</div><Link href="/">{messages.invoiceEditor.backDashboard}</Link></main>;
  }
  return <InvoiceEditor mode="create" defaults={getInvoiceEditorDefaults()} initialInvoice={null} messages={messages.invoiceEditor} />;
}
