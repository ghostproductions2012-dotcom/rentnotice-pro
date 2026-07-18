import ProsePage, { ProseSection } from "@/components/ProsePage";
import { Link } from "wouter";
import { Mail, BookOpen, Users, Download as DownloadIcon } from "lucide-react";

const CHANNELS = [
  {
    icon: Mail,
    title: "Email support",
    body: "The fastest way to reach us for licensing, billing, or technical issues. We respond within one business day.",
    linkLabel: "support@rentnoticepro.com",
    href: "mailto:support@rentnoticepro.com",
    external: true,
  },
  {
    icon: BookOpen,
    title: "FAQ",
    body: "Answers to the most common questions about pricing, state coverage, offline use, and team licensing.",
    linkLabel: "Browse the FAQ",
    href: "/faq",
    external: false,
  },
  {
    icon: Users,
    title: "Customer portal",
    body: "Manage seats, invite team members, update billing, and download license keys for your company.",
    linkLabel: "Open the portal",
    href: "/portal",
    external: false,
  },
  {
    icon: DownloadIcon,
    title: "Downloads",
    body: "Get the latest desktop installers for Mac, Windows, and Linux, and set up the mobile field app.",
    linkLabel: "Go to downloads",
    href: "/download",
    external: false,
  },
];

export default function Support() {
  return (
    <ProsePage
      path="/support"
      heading="Support"
      subheading="We're here to help you get notices out the door — correctly."
    >
      <div className="grid sm:grid-cols-2 gap-6">
        {CHANNELS.map((c) => (
          <div key={c.title} className="border border-white/10 bg-white/[0.02] rounded-md p-6">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
              <c.icon className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">{c.title}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground mb-4">{c.body}</p>
            {c.external ? (
              <a href={c.href} className="text-sm font-semibold text-primary hover:underline">
                {c.linkLabel}
              </a>
            ) : (
              <Link href={c.href} className="text-sm font-semibold text-primary hover:underline">
                {c.linkLabel}
              </Link>
            )}
          </div>
        ))}
      </div>

      <ProseSection title="What to include when you write in">
        <p>
          To help us resolve issues quickly, include your company name, the email on your account,
          your operating system, and — for notice questions — the state involved. Never email
          tenant personal data; we don't need it to help you, and your tenant records stay on your
          machines.
        </p>
      </ProseSection>

      <ProseSection title="Field app access">
        <p>
          Process servers sign in to the RentNotice Field app with a short access code issued from
          the desktop app — no passwords to manage. If a device is lost, revoke its code from the
          desktop and it loses access immediately. See{" "}
          <Link href="/how-it-works" className="text-primary hover:underline">
            how it works
          </Link>{" "}
          for the full workflow.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
