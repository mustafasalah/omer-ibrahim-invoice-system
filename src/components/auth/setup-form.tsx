"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getMessages } from "@/i18n";
import { getCsrfToken, readApiError } from "./client-api";
import { PasswordField } from "./password-field";

export function SetupForm() {
  const router = useRouter();
  const messages = getMessages();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    const form = new FormData(event.currentTarget);

    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/bootstrap/admin", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          username: form.get("username"),
          password: form.get("password"),
          passwordConfirmation: form.get("passwordConfirmation"),
        }),
      });

      if (!response.ok) {
        const apiError = await readApiError(response, messages.errors.internal);
        setError(apiError.message);
        setFieldErrors(apiError.fieldErrors);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setError(messages.auth.connectionError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="auth-alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="auth-field">
        <label htmlFor="displayName">{messages.auth.displayName}</label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="name"
          aria-invalid={Boolean(fieldErrors.displayName)}
          aria-describedby={fieldErrors.displayName ? "displayName-error" : undefined}
          disabled={submitting}
          autoFocus
          required
        />
        {fieldErrors.displayName ? (
          <p className="field-error" id="displayName-error" role="alert">
            {fieldErrors.displayName}
          </p>
        ) : null}
      </div>

      <div className="auth-field">
        <label htmlFor="username">{messages.auth.username}</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          dir="auto"
          aria-invalid={Boolean(fieldErrors.username)}
          aria-describedby={fieldErrors.username ? "username-error" : undefined}
          disabled={submitting}
          required
        />
        {fieldErrors.username ? (
          <p className="field-error" id="username-error" role="alert">
            {fieldErrors.username}
          </p>
        ) : null}
      </div>

      <PasswordField
        id="password"
        name="password"
        label={messages.auth.password}
        autoComplete="new-password"
        error={fieldErrors.password}
        disabled={submitting}
      />
      <PasswordField
        id="passwordConfirmation"
        name="passwordConfirmation"
        label={messages.auth.passwordConfirmation}
        autoComplete="new-password"
        error={fieldErrors.passwordConfirmation}
        disabled={submitting}
      />

      <p className="auth-hint">{messages.auth.passwordPolicy}</p>
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? messages.auth.creatingAdmin : messages.auth.createAdmin}
      </button>
    </form>
  );
}
