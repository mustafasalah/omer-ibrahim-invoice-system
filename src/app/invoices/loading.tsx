import { getMessages } from "@/i18n";

export default function InvoiceLoading() {
  const messages = getMessages().invoiceEditor;
  return <main className="invoice-editor-page invoice-editor-loading" id="main-content" aria-busy="true">
    <div className="invoice-loading-block" /><div className="invoice-loading-block invoice-loading-block--large" />
    <div className="invoice-save-bar"><span>{messages.saving}</span><button type="button" disabled>{messages.saveDraft}</button></div>
  </main>;
}
