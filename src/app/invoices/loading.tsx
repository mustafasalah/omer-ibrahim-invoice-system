import { getMessages } from "@/i18n";

export default function InvoiceLoading() {
  const messages = getMessages().invoiceDetails;
  return <main className="invoice-details-page invoice-details-loading" id="main-content" aria-busy="true">
    <p role="status">{messages.loading}</p>
    <div className="invoice-loading-block" /><div className="invoice-loading-block invoice-loading-block--large" />
  </main>;
}
