// ---------------------------------------------------------------------------
// First-run experience: a fresh install chooses between activating with a
// company license key (online) or exploring the seeded demo workspace
// (fully local). The activation wizard is also reachable from the demo
// lock screen ("Activate with a company license").
// ---------------------------------------------------------------------------

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Scale, KeyRound, FlaskConical } from "lucide-react";
import {
  useActivateWorkspace,
  useEnterDemoMode,
  useRedeemInviteCode,
  useValidateLicenseKey,
} from "@/lib/api/hooks";
import type { LicenseSummary } from "@/lib/licensing/types";

/** Team invite codes look like INV-XXXX-XXXX; license keys start with RNP-. */
function isInviteCode(value: string): boolean {
  return value.trim().toUpperCase().startsWith("INV-");
}

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background relative overflow-hidden p-4">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
      <Card className="w-full max-w-md shadow-xl border-primary/10 relative z-10">
        <CardHeader className="text-center space-y-2 pb-6">
          <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Scale className="w-8 h-8" />
          </div>
          <CardTitle className="text-3xl font-serif font-semibold tracking-tight">
            {title}
          </CardTitle>
          <CardDescription className="text-base">{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

export function ActivationWizard({
  onCancel,
  replacesExistingData = false,
}: {
  onCancel?: () => void;
  /** Shown when activating over an existing demo workspace. */
  replacesExistingData?: boolean;
}) {
  const validate = useValidateLicenseKey();
  const activate = useActivateWorkspace();
  const redeem = useRedeemInviteCode();
  const [licenseKey, setLicenseKey] = useState("");
  const [license, setLicense] = useState<LicenseSummary | null>(null);
  const [inviteStep, setInviteStep] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [secret, setSecret] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleValidate = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Invite codes skip key validation: the code is checked when redeemed,
    // after the invitee picks their name and password.
    if (isInviteCode(licenseKey)) {
      setInviteStep(true);
      return;
    }
    validate.mutate(licenseKey, {
      onSuccess: (summary) => {
        if (summary.status === "paused") {
          setError(
            "This license is currently paused (check the subscription billing). It cannot activate new devices.",
          );
        } else if (summary.status === "cancelled") {
          setError("This license has been cancelled and can no longer activate devices.");
        } else {
          setLicense(summary);
        }
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Could not check the license key."),
    });
  };

  const handleActivate = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    activate.mutate(
      { licenseKey, identifier: identifier.trim(), secret },
      {
        onError: (err) =>
          setError(err instanceof Error ? err.message : "Activation failed. Please try again."),
      },
    );
  };

  const handleRedeem = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (invitePassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (invitePassword !== invitePasswordConfirm) {
      setError("Passwords do not match.");
      return;
    }
    redeem.mutate(
      { inviteCode: licenseKey, name: inviteName.trim(), password: invitePassword },
      {
        onError: (err) =>
          setError(
            err instanceof Error ? err.message : "Could not redeem the invite code. Please try again.",
          ),
      },
    );
  };

  if (inviteStep) {
    return (
      <Shell
        title="Join your team"
        description="Set up your account to finish activating this device."
      >
        <form onSubmit={handleRedeem} className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-invite-code-display">
            Invite code: <span className="font-mono font-medium">{licenseKey.trim().toUpperCase()}</span>
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="invite-name">
              Your full name
            </label>
            <Input
              id="invite-name"
              type="text"
              autoComplete="name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              autoFocus
              data-testid="input-invite-name"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="invite-password">
              Create a password
            </label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              value={invitePassword}
              onChange={(e) => setInvitePassword(e.target.value)}
              placeholder="At least 8 characters"
              data-testid="input-invite-password"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="invite-password-confirm">
              Confirm password
            </label>
            <Input
              id="invite-password-confirm"
              type="password"
              autoComplete="new-password"
              value={invitePasswordConfirm}
              onChange={(e) => setInvitePasswordConfirm(e.target.value)}
              data-testid="input-invite-password-confirm"
            />
          </div>
          {replacesExistingData && (
            <p
              className="text-xs text-amber-600 dark:text-amber-500"
              data-testid="text-invite-warning"
            >
              Joining replaces all demo data on this device with your company workspace.
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-invite-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              !inviteName.trim() || !invitePassword || !invitePasswordConfirm || redeem.isPending
            }
            data-testid="button-redeem-invite"
          >
            {redeem.isPending ? "Joining…" : "Join and activate this device"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setInviteStep(false);
              setError(null);
            }}
            data-testid="button-invite-back"
          >
            Use a different code
          </Button>
        </form>
      </Shell>
    );
  }

  if (!license) {
    return (
      <Shell
        title="Activate RentNotice Pro"
        description="Enter your company license key, or the invite code your admin sent you."
      >
        <form onSubmit={handleValidate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="license-key">
              License key or invite code
            </label>
            <Input
              id="license-key"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="RNP-XXXX-XXXX-XXXX-XXXX or INV-XXXX-XXXX"
              autoFocus
              data-testid="input-license-key"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-license-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={!licenseKey.trim() || validate.isPending}
            data-testid="button-validate-key"
          >
            {validate.isPending ? "Checking…" : "Continue"}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={onCancel}
              data-testid="button-activation-back"
            >
              Back
            </Button>
          )}
        </form>
      </Shell>
    );
  }

  return (
    <Shell title={license.companyName} description={license.plan ?? "Company license"}>
      <form onSubmit={handleActivate} className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="text-company-name">
          Sign in with your company account to finish activating this device. An internet
          connection is required for this step.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="activation-identifier">
            Email
          </label>
          <Input
            id="activation-identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoFocus
            data-testid="input-activation-identifier"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="activation-secret">
            Password
          </label>
          <Input
            id="activation-secret"
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            data-testid="input-activation-secret"
          />
        </div>
        {replacesExistingData && (
          <p
            className="text-xs text-amber-600 dark:text-amber-500"
            data-testid="text-activation-warning"
          >
            Activating replaces all demo data on this device with your company workspace.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="text-activation-error">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={!identifier.trim() || !secret || activate.isPending}
          data-testid="button-activate"
        >
          {activate.isPending ? "Activating…" : "Activate this device"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setLicense(null);
            setError(null);
          }}
          data-testid="button-activation-change-key"
        >
          Use a different key
        </Button>
      </form>
    </Shell>
  );
}

export function FirstRunScreen() {
  const enterDemo = useEnterDemoMode();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (activating) {
    return <ActivationWizard onCancel={() => setActivating(false)} />;
  }

  return (
    <Shell
      title="RentNotice Pro"
      description="California notice compliance for property managers"
    >
      <div className="space-y-3">
        <Button
          className="w-full justify-start h-auto py-4 whitespace-normal"
          onClick={() => setActivating(true)}
          data-testid="button-choose-activate"
        >
          <KeyRound className="w-5 h-5 mr-3 shrink-0" />
          <span className="flex flex-col items-start text-left">
            <span className="font-semibold">Activate with a license key</span>
            <span className="text-xs opacity-80 font-normal">
              Set up this device for your company
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start h-auto py-4 whitespace-normal"
          onClick={() =>
            enterDemo.mutate(undefined, {
              onError: (err) =>
                setError(err instanceof Error ? err.message : "Could not load the demo."),
            })
          }
          disabled={enterDemo.isPending}
          data-testid="button-explore-demo"
        >
          <FlaskConical className="w-5 h-5 mr-3 shrink-0" />
          <span className="flex flex-col items-start text-left">
            <span className="font-semibold">
              {enterDemo.isPending ? "Preparing demo…" : "Explore the demo"}
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              Sample company with realistic data — nothing leaves this device
            </span>
          </span>
        </Button>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="text-firstrun-error">
            {error}
          </p>
        )}
      </div>
    </Shell>
  );
}
