import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Monitor, Apple, Download as DownloadIcon, ShieldAlert, ExternalLink } from "lucide-react";
import {
  fetchLatestRelease,
  resolveDownloadLinks,
  RELEASES_LATEST_URL,
  type DownloadLinks,
} from "@/lib/releases";

export default function Download() {
  const { data, isLoading } = useQuery({
    queryKey: ["latest-release"],
    queryFn: fetchLatestRelease,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const links: DownloadLinks | null = data ? resolveDownloadLinks(data) : null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="flex items-center justify-between py-6 px-8 max-w-7xl mx-auto w-full">
        <Link href="/" className="text-2xl font-serif font-bold text-primary tracking-tight">RentNotice Pro</Link>
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link href="/download" className="text-foreground font-semibold">Download</Link>
          <Link href="/pricing" className="text-foreground/80 hover:text-foreground transition-colors">Pricing</Link>
          <Link href="/login" className="text-foreground/80 hover:text-foreground transition-colors">Log in</Link>
          <Link href="/signup" className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors shadow-sm">Get Started</Link>
        </nav>
      </header>

      <main className="flex-1 py-16 px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">Download RentNotice Pro</h1>
            <p className="text-xl text-muted-foreground">
              Install the desktop software on Windows or Mac, then activate it with the license key from your{" "}
              <Link href="/portal" className="text-primary underline underline-offset-4">customer portal</Link>.
            </p>
            {links?.version && (
              <p className="text-sm text-muted-foreground mt-3">Latest version: <span className="font-semibold">{links.version}</span></p>
            )}
          </div>

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
                <Button asChild size="lg" className="w-full" disabled={isLoading}>
                  <a href={links?.windowsExe ?? RELEASES_LATEST_URL} data-testid="button-download-windows">
                    <DownloadIcon className="w-4 h-4 mr-2" />
                    {isLoading ? "Loading…" : "Download for Windows (.exe)"}
                  </a>
                </Button>
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
                  The first time you open the software, macOS may say it "cannot verify the developer."{" "}
                  <span className="font-semibold text-foreground">Right-click (or Control-click) the software and choose Open</span>,
                  then click Open again to confirm.
                </p>
              </CardContent>
              <CardFooter className="flex flex-col gap-2">
                <Button asChild size="lg" className="w-full" disabled={isLoading}>
                  <a href={links?.macAppleSilicon ?? RELEASES_LATEST_URL} data-testid="button-download-mac-arm">
                    <DownloadIcon className="w-4 h-4 mr-2" />
                    {isLoading ? "Loading…" : "Download for Apple Silicon (M1–M4)"}
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full" disabled={isLoading}>
                  <a href={links?.macIntel ?? RELEASES_LATEST_URL} data-testid="button-download-mac-intel">
                    <DownloadIcon className="w-4 h-4 mr-2" />
                    {isLoading ? "Loading…" : "Download for Intel Mac"}
                  </a>
                </Button>
              </CardFooter>
            </Card>
          </div>

          <Alert className="mt-10">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Why the security warnings?</AlertTitle>
            <AlertDescription>
              RentNotice Pro installers are not yet code-signed, so Windows and macOS show a one-time
              caution message for software from new publishers. The download always comes directly from our
              official GitHub releases page, and the steps above let you proceed safely.
            </AlertDescription>
          </Alert>

          <div className="text-center mt-10">
            <a
              href={RELEASES_LATEST_URL}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
              data-testid="link-all-releases"
            >
              <ExternalLink className="w-4 h-4" />
              View all releases and release notes on GitHub
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
