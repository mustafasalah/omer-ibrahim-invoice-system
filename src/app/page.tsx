import { getMessages } from "@/i18n";

export default function HomePage() {
  const messages = getMessages();

  return (
    <main className="foundation" id="main-content">
      <section className="foundation__hero" aria-labelledby="page-title">
        <p className="foundation__eyebrow">{messages.home.eyebrow}</p>
        <h1 id="page-title">{messages.home.title}</h1>
        <p className="foundation__description">{messages.home.description}</p>
        <a className="foundation__health-link" href="/api/health" dir="ltr">
          {messages.home.healthLabel}: /api/health
        </a>
      </section>

      <section className="foundation__grid" aria-label={messages.home.scopeTitle}>
        <article className="foundation__card">
          <span className="foundation__number" aria-hidden="true">
            01
          </span>
          <h2>{messages.home.foundationTitle}</h2>
          <p>{messages.home.foundationDescription}</p>
        </article>
        <article className="foundation__card">
          <span className="foundation__number" aria-hidden="true">
            02
          </span>
          <h2>{messages.home.databaseTitle}</h2>
          <p>{messages.home.databaseDescription}</p>
        </article>
        <article className="foundation__card foundation__card--scope">
          <span className="foundation__number" aria-hidden="true">
            —
          </span>
          <h2>{messages.home.scopeTitle}</h2>
          <p>{messages.home.scopeDescription}</p>
        </article>
      </section>
    </main>
  );
}
