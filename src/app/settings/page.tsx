import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings/settings-form";
import { getMessages } from "@/i18n";
import { optionalPageSession } from "@/server/auth/page-session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await optionalPageSession();
  if (!session) redirect("/login");
  const messages = getMessages();
  if (!session.user.capabilities.includes("settings.manage")) {
    return <main className="settings-page" id="main-content"><div className="settings-alert" role="alert">{messages.settings.forbidden}</div></main>;
  }
  return <SettingsForm messages={messages.settings} />;
}

