"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getMessages } from "@/i18n";
import { getCsrfToken } from "./client-api";

export function LogoutButton() {
  const router = useRouter();
  const messages = getMessages();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);

    try {
      const csrfToken = await getCsrfToken();
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
    } finally {
      router.replace("/login");
      router.refresh();
      setSubmitting(false);
    }
  }

  return (
    <button className="dashboard__logout" type="button" onClick={logout} disabled={submitting}>
      {submitting ? messages.auth.loggingOut : messages.auth.logout}
    </button>
  );
}
