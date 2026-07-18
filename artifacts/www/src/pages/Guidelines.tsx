import ProsePage, { ProseSection } from "@/components/ProsePage";
import { Link } from "wouter";

export default function Guidelines() {
  return (
    <ProsePage
      path="/guidelines"
      heading="Eviction Guidelines"
      subheading="A practical overview of the nonpayment eviction process for property managers."
    >
      <div className="border border-primary/30 bg-primary/5 rounded-md p-5 text-sm leading-relaxed text-muted-foreground">
        These guidelines are general education, not legal advice. Eviction law varies by state,
        county, and city, and changes frequently. Always have a licensed attorney in your
        jurisdiction review notices and filings before you act.
      </div>

      <ProseSection title="1. Verify the delinquency before anything else">
        <p>
          Most contested evictions fail on the numbers. Before preparing a notice, reconcile the
          tenant's ledger: confirm rent charges, payments, and credits, and separate rent from
          non-rent charges. Many states — including California — require a pay-or-quit notice to
          demand rent only, so including late fees or utilities can invalidate the notice.
          RentNotice Pro isolates the rent-only balance automatically when you import a ledger.
        </p>
      </ProseSection>

      <ProseSection title="2. Use the correct notice for your state">
        <p>
          Every state sets its own notice type, demand contents, and waiting period — from 3-day
          notices in states like California and Texas to 14 days or more elsewhere. Some
          jurisdictions add local requirements on top, such as rent-control just-cause rules or
          mandatory tenant-resource language. Check the statutory notice period and citation for
          your state on our{" "}
          <Link href="/coverage" className="text-primary hover:underline">
            state notice laws page
          </Link>
          .
        </p>
      </ProseSection>

      <ProseSection title="3. Calculate the deadline carefully">
        <p>
          Notice periods usually begin the day after service, and many states exclude weekends and
          court holidays from short notice periods. An expiration date that lands a day early is a
          common reason judges dismiss cases. RentNotice Pro applies state rules and court holiday
          calendars when computing the expiration date.
        </p>
      </ProseSection>

      <ProseSection title="4. Serve the notice properly and keep proof">
        <p>
          States prescribe how a notice may be served — personal delivery, substituted service,
          and posting-and-mailing are the common methods, each with its own prerequisites. Whoever
          serves the notice should record when, where, and how it was served, and photograph
          posted notices. A sworn proof of service is required in court. The RentNotice Field app
          captures GPS-tagged, time-stamped photos so your evidence holds up.
        </p>
      </ProseSection>

      <ProseSection title="5. Wait out the notice period">
        <p>
          If the tenant pays the full demanded amount within the notice period, the tenancy
          continues and the matter ends. Accepting partial payment can waive the notice in some
          states — talk to your attorney before taking any money after service. Do not change
          locks, remove belongings, or shut off utilities; "self-help" evictions are illegal
          everywhere and carry serious penalties.
        </p>
      </ProseSection>

      <ProseSection title="6. File the unlawful detainer if the notice expires">
        <p>
          If the deadline passes without full payment or possession being returned, the next step
          is a court filing (often called an unlawful detainer or forcible entry and detainer).
          Bring your notice, proof of service, and ledger. Notices generated with RentNotice Pro
          bundle these into a court-ready packet, including an audit summary of how every figure
          was calculated.
        </p>
      </ProseSection>

      <ProseSection title="Common mistakes to avoid">
        <p>• Demanding more than the statute allows (late fees, utilities, future rent).</p>
        <p>• Miscounting the notice period across weekends or court holidays.</p>
        <p>• Serving by a method your state does not authorize, or failing to document service.</p>
        <p>• Ignoring local rent-control or just-cause ordinances layered on state law.</p>
        <p>• Accepting rent after the notice expires without legal guidance.</p>
      </ProseSection>

      <ProseSection title="Keep going">
        <p>
          Review your state's specifics on the{" "}
          <Link href="/coverage" className="text-primary hover:underline">
            state notice laws page
          </Link>
          , see{" "}
          <Link href="/how-it-works" className="text-primary hover:underline">
            how RentNotice Pro automates each step
          </Link>
          , or{" "}
          <Link href="/support" className="text-primary hover:underline">
            contact support
          </Link>{" "}
          with questions about the software.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
