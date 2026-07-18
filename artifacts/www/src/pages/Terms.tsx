import ProsePage, { ProseSection } from "@/components/ProsePage";
import { Link } from "wouter";

export default function Terms() {
  return (
    <ProsePage
      path="/terms"
      heading="Terms of Service"
      subheading="Effective date: July 18, 2026"
    >
      <ProseSection title="1. Agreement">
        <p>
          These Terms of Service ("Terms") govern your access to and use of the RentNotice Pro
          desktop application, the RentNotice Field mobile application, the customer portal, and
          related services (together, the "Service"). By creating an account, installing the
          software, or using the Service, you agree to these Terms on behalf of yourself and the
          company you represent.
        </p>
      </ProseSection>

      <ProseSection title="2. The Service is not legal advice">
        <p>
          RentNotice Pro is document preparation software. It calculates amounts, applies
          state-specific notice periods, and formats pay-or-quit notices for all 50 states and DC.
          California templates are attorney-reviewed; templates for other states are generic
          starting points that are not attorney-reviewed. The Service does not provide legal
          advice, and no attorney-client relationship is created by using it. Landlord-tenant law
          changes frequently and varies by city and county. You are responsible for having a
          licensed attorney in your jurisdiction review notices before service, and for compliance
          with all applicable laws, including local rent control and just-cause ordinances.
        </p>
      </ProseSection>

      <ProseSection title="3. Accounts and licensing">
        <p>
          Subscriptions are licensed per seat. Administrators may invite team members and assign
          roles from the customer portal. You are responsible for maintaining the confidentiality
          of credentials, license keys, and field access codes issued under your account, and for
          all activity that occurs under them. Licenses may not be shared between individuals or
          resold.
        </p>
      </ProseSection>

      <ProseSection title="4. Billing and cancellation">
        <p>
          Paid plans are billed in advance through Stripe on a recurring basis. You can update
          payment methods, change plans, or cancel at any time through the self-serve billing
          portal; cancellation takes effect at the end of the current billing period. Except where
          required by law, fees are non-refundable. If a payment fails and is not remedied, we may
          suspend or downgrade the associated licenses after notice.
        </p>
      </ProseSection>

      <ProseSection title="5. Your data">
        <p>
          RentNotice Pro is local-first: tenant records, ledgers, and generated documents are
          stored on your own machines. You retain all rights to the data you create with the
          Service. Limited data is processed by our servers only where a feature requires it — for
          example license validation, team chat, and syncing field assignments between the desktop
          and mobile apps. You are responsible for the accuracy of the data you enter and for
          maintaining backups of your local databases.
        </p>
      </ProseSection>

      <ProseSection title="6. Acceptable use">
        <p>
          You agree not to use the Service to harass tenants, to prepare notices you know to be
          false or retaliatory, or otherwise to violate fair-housing, anti-retaliation, or
          consumer-protection laws. You may not reverse engineer, sublicense, or circumvent
          licensing controls of the software, or probe or disrupt our infrastructure.
        </p>
      </ProseSection>

      <ProseSection title="7. Intellectual property">
        <p>
          The Service, including its software, templates, and branding, is owned by RentNotice Pro
          and protected by intellectual property laws. We grant you a limited, non-exclusive,
          non-transferable license to use the software for your internal property-management
          business during your subscription term. Documents you generate with your own data are
          yours.
        </p>
      </ProseSection>

      <ProseSection title="8. Disclaimers and limitation of liability">
        <p>
          The Service is provided "as is" without warranties of any kind, express or implied,
          including fitness for a particular purpose. We do not warrant that any notice produced by
          the Service will be enforceable in your jurisdiction. To the maximum extent permitted by
          law, RentNotice Pro will not be liable for indirect, incidental, special, consequential,
          or punitive damages, or for lost profits, lost rents, or adverse case outcomes. Our total
          liability for any claim arising out of the Service is limited to the amounts you paid us
          in the twelve months before the claim arose.
        </p>
      </ProseSection>

      <ProseSection title="9. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for
          material breach of these Terms, including non-payment or license abuse. Because the
          software is local-first, your locally stored data remains on your machines after
          termination.
        </p>
      </ProseSection>

      <ProseSection title="10. Changes to these Terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we will post
          the updated Terms on this page with a new effective date, and where practical notify
          account administrators by email. Continued use of the Service after changes take effect
          constitutes acceptance.
        </p>
      </ProseSection>

      <ProseSection title="11. Contact">
        <p>
          Questions about these Terms? Email{" "}
          <a href="mailto:support@rentnoticepro.com" className="text-primary hover:underline">
            support@rentnoticepro.com
          </a>{" "}
          or visit the{" "}
          <Link href="/support" className="text-primary hover:underline">
            support page
          </Link>
          .
        </p>
      </ProseSection>
    </ProsePage>
  );
}
