import ProsePage, { ProseSection } from "@/components/ProsePage";
import { Link } from "wouter";

export default function Privacy() {
  return (
    <ProsePage
      path="/privacy"
      heading="Privacy Policy"
      subheading="Effective date: July 18, 2026"
    >
      <ProseSection title="Local-first by design">
        <p>
          RentNotice Pro is built local-first. Your tenant records, property information, rent
          ledgers, and generated notices are stored in a database on your own computer — not on our
          servers. We do not aggregate, mine, or sell your property-management data. This policy
          explains the limited information we do collect and how we handle it.
        </p>
      </ProseSection>

      <ProseSection title="Information we collect">
        <p>
          <span className="text-foreground font-medium">Account information.</span> When you sign
          up we collect your name, email address, and company name to create your account, issue
          licenses, and send transactional email such as receipts and team invitations.
        </p>
        <p>
          <span className="text-foreground font-medium">Billing information.</span> Payments are
          processed by Stripe. Your card details go directly to Stripe and never touch our
          servers; we store only the subscription status and plan needed to license your seats.
        </p>
        <p>
          <span className="text-foreground font-medium">Sync and collaboration data.</span> A few
          features require our servers to relay data between your devices: field assignments
          dispatched to process servers (property address, tenant name, notice type, and the
          photos and GPS coordinates your team captures as proof of service) and team chat
          messages. This data is scoped to your company and used only to provide those features.
        </p>
        <p>
          <span className="text-foreground font-medium">Technical logs.</span> Like most services,
          our servers keep short-lived operational logs (such as IP address and request metadata)
          for security, rate limiting, and troubleshooting.
        </p>
      </ProseSection>

      <ProseSection title="What we do not collect">
        <p>
          We do not receive your rent ledgers, tenant payment histories, or the contents of the
          notices you generate, except where you explicitly dispatch an assignment to the field or
          send a chat message. We do not use advertising trackers and we do not sell personal
          information.
        </p>
      </ProseSection>

      <ProseSection title="Service providers">
        <p>
          We share data only with the processors needed to run the Service: Stripe for payments
          and billing, our email provider for transactional email, and our hosting provider for
          the API server. Each processor receives only what it needs to perform its function.
        </p>
      </ProseSection>

      <ProseSection title="Retention and deletion">
        <p>
          Account and licensing records are kept while your subscription is active and for as long
          as needed for tax and accounting obligations afterward. Field assignment data and chat
          messages can be deleted by your administrators from within the apps. Sign-in tokens for
          team chat expire automatically. To request deletion of your account data, email us at
          the address below.
        </p>
      </ProseSection>

      <ProseSection title="Security">
        <p>
          Data in transit between the apps and our servers is encrypted with TLS. Field devices
          authenticate with short access codes that your office can revoke at any time, and
          revoked or expired credentials stop working immediately. Because your primary data lives
          on your own machines, we recommend using full-disk encryption and regular backups.
        </p>
      </ProseSection>

      <ProseSection title="Your rights">
        <p>
          Depending on where you live, you may have rights to access, correct, export, or delete
          the personal information we hold about you. Email us and we will respond within the
          timelines required by applicable law. Tenant data stored locally by your company is
          controlled by your company — requests about it should go to the property manager who
          holds it.
        </p>
      </ProseSection>

      <ProseSection title="Changes to this policy">
        <p>
          If we make material changes to this policy, we will post the updated version here with a
          new effective date and notify account administrators by email where practical.
        </p>
      </ProseSection>

      <ProseSection title="Contact">
        <p>
          Privacy questions or requests:{" "}
          <a href="mailto:support@rentnoticepro.com" className="text-primary hover:underline">
            support@rentnoticepro.com
          </a>
          . General help is available on the{" "}
          <Link href="/support" className="text-primary hover:underline">
            support page
          </Link>
          .
        </p>
      </ProseSection>
    </ProsePage>
  );
}
