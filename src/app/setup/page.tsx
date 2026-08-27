import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth/setup-form";
import { getMessages } from "@/i18n";
import { getBootstrapStatus } from "@/server/auth/bootstrap";
import { isLoopbackAddress } from "@/server/auth/network";
import { getConfig } from "@/server/config/env";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (!getBootstrapStatus().bootstrapRequired) {
    redirect("/login");
  }

  const messages = getMessages();
  const bootstrapAvailable = isLoopbackAddress(getConfig().host);

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label={messages.auth.systemName}>
        <span className="auth-brand__mark" aria-hidden="true">OI</span>
        <p>{messages.auth.companyName}</p>
        <h1>{messages.auth.setupTitle}</h1>
        <p className="auth-brand__description">{messages.auth.setupDescription}</p>
        <span className="local-badge">{messages.auth.localOnly}</span>
      </section>
      <section className="auth-card" aria-labelledby="setup-form-title">
        <h2 id="setup-form-title">{messages.auth.createFirstAdmin}</h2>
        <p>{messages.auth.setupFormDescription}</p>
        {bootstrapAvailable ? (
          <SetupForm />
        ) : (
          <div className="auth-alert" role="alert">
            {messages.auth.setupUnavailableOnLan}
          </div>
        )}
      </section>
    </main>
  );
}
