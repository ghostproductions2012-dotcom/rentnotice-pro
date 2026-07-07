import { useSettings, useCompanyProfile } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: company } = useCompanyProfile();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure company profile, security, and preferences.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Company Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Organization Name</div>
              <div>{company?.name || "Not configured"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Address</div>
              <div>{company?.address}</div>
            </div>
            <Button variant="outline" className="mt-2">Edit Profile</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security & Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <div className="font-medium">Require Attorney Review</div>
                <div className="text-sm text-muted-foreground">Prevent using non-reviewed templates</div>
              </div>
              <div className="font-semibold text-primary">{settings?.requireAttorneyReviewedTemplate ? "Enabled" : "Disabled"}</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Session Auto-lock</div>
                <div className="text-sm text-muted-foreground">Idle time before PIN required</div>
              </div>
              <div className="font-semibold">{settings?.autoLockMinutes} minutes</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
