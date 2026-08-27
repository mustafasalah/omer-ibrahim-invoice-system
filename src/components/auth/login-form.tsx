"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getMessages } from "@/i18n";
import { getCsrfToken, readApiError } from "./client-api";
import { PasswordField } from "./password-field";

export function LoginForm() {
  const router = useRouter();
  const messages = getMessages();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);

    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const apiError = await readApiError(response, messages.auth.invalidCredentials);
        setError(apiError.message);
        return;
      }

      router.replace("/");
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
        <label htmlFor="username">{messages.auth.username}</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          dir="auto"
          disabled={submitting}
          autoFocus
          required
        />
      </div>

      <PasswordField
        id="password"
        name="password"
        label={messages.auth.password}
        autoComplete="current-password"
        disabled={submitting}
      />

      <p className="auth-hint">{messages.auth.contactAdmin}</p>
      <button className="auth-submit" type="submit" disabled={submitting}>
        {submitting ? messages.auth.loggingIn : messages.auth.loginButton}
      </button>
    </form>
  );
}
