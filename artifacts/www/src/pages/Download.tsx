import { Link } from "wouter";
import SiteHeader from "@/components/SiteHeader";
import Seo from "@/components/Seo";
import { useGetLatestDownloads, getGetLatestDownloadsQueryKey } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Monitor, Apple, Download as DownloadIcon, ShieldAlert, AlertCircle } from "lucide-react";

interface DownloadButtonProps {
  href: string | null | undefined;
  label: string;
  loadingLabel?: string;
  isLoading: boolean;
  variant?: "default" | "outline";
  testId: string;
}

const downloadButtonClasses = "w-full whitespace-normal h-auto min-h-10";

function DownloadButton({ href, label, isLoading, variant = "default", testId }: DownloadButtonProps) {
  if (isLoading) {
    return (
      <Button size="lg" variant={variant} className={downloadButtonClasses} disabled data-testid={testId}>
        <DownloadIcon className="w-4 h-4 mr-2" />
        Loading…
      </Button>
    );
  }
  if (!href) {
    return (
      <Button size="lg" variant={variant} className={downloadButtonClasses} disabled data-testid={testId}>
        <DownloadIcon className="w-4 h-4 mr-2" />
        Temporarily unavailable
      </Button>
    );
  }
  return (
    <Button asChild size="lg" variant={variant} className={downloadButtonClasses}>
      <a href={href} data-testid={testId}>
        <DownloadIcon className="w-4 h-4 mr-2" />
        {label}
      </a>
    </Button>
  );
}

export default function Download() {
  const { data: links, isLoading, isError } = useGetLatestDownloads({
    query: {
      queryKey: getGetLatestDownloadsQueryKey(),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  });

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Seo
        title="Download — RentNotice Pro"
        description="Download RentNotice Pro for Windows and macOS. Get the desktop app for automated rent notices, deadline tracking, and court-ready evidence."
        path="/download"
      />
      <SiteHeader />

      <main className="flex-1 py-10 md:py-16 px-4 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif text-foreground mb-4">Download RentNotice Pro</h1>
            <p className="text-xl text-muted-foreground">
              Install the desktop software on Windows or Mac, then activate it with the license key from your{" "}
              <Link href="/portal" className="text-primary underline underline-offset-4">customer portal</Link>.
            </p>
            {links?.version && (
              <p className="text-sm text-muted-foreground mt-3" data-testid="text-latest-version">
                Latest version: <span className="font-semibold">{links.version}</span>
              </p>
            )}
          </div>

          {isError && (
            <Alert className="mb-8" data-testid="alert-downloads-unavailable">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Downloads temporarily unavailable</AlertTitle>
              <AlertDescription>
                We couldn't load the latest installers right now. Please check back in a few
                minutes — no action is needed on your part.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid md:grid-cols-2 gap-8">
            {/* Windows */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <Monitor className="w-7 h-7 text-primary" />
                  Windows
                </CardTitle>
                <CardDescription className="text-base">Windows 10 or 11 (64-bit)</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-sm text-muted-foreground space-y-2">
                <p>Download the installer, double-click it, and follow the prompts.</p>
                <p>
                  Because this build isn't yet code-signed, Windows SmartScreen may show
                  "Windows protected your PC." Click <span className="font-semibold text-foreground">More info</span>, then{" "}
                  <span className="font-semibold text-foreground">Run anyway</span> to continue.
                </p>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                <DownloadButton
                  href={links?.windowsExe}
                  label="Download for Windows (.exe)"
                  isLoading={isLoading}
                  testId="button-download-windows"
                />
                {links?.windowsMsi && (
                  <a href={links.windowsMsi} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4" data-testid="link-download-msi">
                    Prefer an MSI package? Download the .msi
                  </a>
                )}
              </CardFooter>
            </Card>

            {/* macOS */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <Apple className="w-7 h-7 text-primary" />
                  Mac
                </CardTitle>
                <CardDescription className="text-base">macOS 10.15 Catalina or later</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 text-sm text-muted-foreground space-y-2">
                <p>Download the .dmg for your Mac, open it, and drag RentNotice Pro into Applications.</p>
                <p>
                  RentNotice Pro is signed and notarized by Apple, so it opens normally — no
                  security warnings, no extra steps.
                </p>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                <DownloadButton
                  href={links?.macAppleSilicon}
                  label="Download for Apple Silicon (M1–M4)"
                  isLoading={isLoading}
                  testId="button-download-mac-arm"
                />
                <DownloadButton
                  href={links?.macIntel}
                  label="Download for Intel Mac"
                  isLoading={isLoading}
                  variant="outline"
                  testId="button-download-mac-intel"
                />
                {links?.macVersion && (
                  <p className="text-xs text-muted-foreground" data-testid="text-mac-version">
                    Mac installers are currently {links.macVersion}; the {links.version} Mac build
                    will appear here as soon as it's ready.
                  </p>
                )}
              </CardFooter>
            </Card>
          </div>

          <Alert className="mt-10">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Why the Windows security warning?</AlertTitle>
            <AlertDescription>
              The Windows installer is not yet code-signed, so Windows SmartScreen shows a one-time
              caution message for software from new publishers. The Mac version is signed and notarized
              by Apple. Every download comes directly from our official release servers.
            </AlertDescription>
          </Alert>
        </div>
      </main>
    </div>
  );
}
