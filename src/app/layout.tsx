import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-arabic";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GlobalShortcuts } from "@/components/navigation/global-shortcuts";
import { defaultLocale, getDirection, getMessages } from "@/i18n";
import "@/styles/globals.css";

const messages = getMessages();

export const metadata: Metadata = {
  title: messages.metadata.title,
  description: messages.metadata.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={defaultLocale} dir={getDirection(defaultLocale)}>
      <body>
        <a className="skip-link" href="#main-content">
          {messages.accessibility.skipToContent}
        </a>
        <GlobalShortcuts />
        {children}
      </body>
    </html>
  );
}
