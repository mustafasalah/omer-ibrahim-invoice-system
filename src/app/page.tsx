import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { getMessages } from "@/i18n";
import { getBootstrapStatus } from "@/server/auth/bootstrap";
import { optionalPageSession } from "@/server/auth/page-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (getBootstrapStatus().bootstrapRequired) {
    redirect("/setup");
  }

  const session = await optionalPageSession();

  if (!session) {
    redirect("/login");
  }

  const messages = getMessages();

  return (
    <main className="dashboard" id="main-content">
      <header className="dashboard__header">
        <div>
          <p className="dashboard__eyebrow">{messages.auth.companyName}</p>
          <h1>{messages.dashboard.title}</h1>
        </div>
        <LogoutButton />
      </header>
      <section className="dashboard__welcome" aria-labelledby="welcome-title">
        <p>{messages.dashboard.signedInAs}</p>
        <h2 id="welcome-title">{session.user.displayName}</h2>
        <p>{messages.dashboard.protectedDescription}</p>
        <dl>
          <div>
            <dt>{messages.dashboard.username}</dt>
            <dd dir="auto">{session.user.username}</dd>
          </div>
          <div>
            <dt>{messages.dashboard.role}</dt>
            <dd>{session.user.role === "ADMIN" ? messages.dashboard.admin : messages.dashboard.employee}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
