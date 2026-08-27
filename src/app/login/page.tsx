import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getMessages } from "@/i18n";
import { getBootstrapStatus } from "@/server/auth/bootstrap";
import { optionalPageSession } from "@/server/auth/page-session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (getBootstrapStatus().bootstrapRequired) {
    redirect("/setup");
  }

  if (await optionalPageSession()) {
    redirect("/");
  }

  const messages = getMessages();

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label={messages.auth.systemName}>
        <span className="auth-brand__mark" aria-hidden="true">OI</span>
        <p>{messages.auth.companyName}</p>
        <h1>{messages.auth.systemName}</h1>
        <p className="auth-brand__description">{messages.auth.loginDescription}</p>
        <span className="local-badge">{messages.auth.runningLocally}</span>
      </section>
      <section className="auth-card" aria-labelledby="login-form-title">
        <h2 id="login-form-title">{messages.auth.loginTitle}</h2>
        <p>{messages.auth.loginPrompt}</p>
        <LoginForm />
      </section>
    </main>
  );
}
