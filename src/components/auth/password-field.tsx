"use client";

import { useState } from "react";
import { getMessages } from "@/i18n";

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const messages = getMessages();
  const errorId = `${props.id}-error`;

  return (
    <div className="auth-field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="password-control">
        <input
          id={props.id}
          name={props.name}
          type={visible ? "text" : "password"}
          autoComplete={props.autoComplete}
          aria-invalid={Boolean(props.error)}
          aria-describedby={props.error ? errorId : undefined}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-pressed={visible}
          aria-label={visible ? messages.auth.hidePassword : messages.auth.showPassword}
          onClick={() => setVisible((current) => !current)}
          disabled={props.disabled}
        >
          {visible ? messages.auth.hide : messages.auth.show}
        </button>
      </div>
      {props.error ? (
        <p className="field-error" id={errorId} role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
