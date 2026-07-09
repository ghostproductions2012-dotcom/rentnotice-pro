import { useListCompanyUsers, useInviteCompanyUser, useUpdateCompanyUser, getListCompanyUsersQueryKey, useGetMe, useGetPortalOverview, useGetInviteCode, useRegenerateInviteCode, getGetInviteCodeQueryKey } from "@workspace/api-client-react";
import PortalLayout from "./PortalLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, MoreHorizontal, Shield, UserPlus, Users as UsersIcon } from "lucide-react";
import type { CompanyUser } from "@workspace/api-client-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";

const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "manager", "staff", "readonly"]),
});

export default function Users() {
  const { data: me } = useGetMe();
  const { data: users, isLoading } = useListCompanyUsers();
  const { data: overview } = useGetPortalOverview();
  const queryClient = useQueryClient();
  const inviteMutation = useInviteCompanyUser();
  const updateMutation = useUpdateCompanyUser();
  
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{code: string, email: string, emailSent: boolean, expiresAt: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteCodeTarget, setInviteCodeTarget] = useState<CompanyUser | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [regenResult, setRegenResult] = useState<{email: string, emailSent: boolean} | null>(null);
  const [regenError, setRegenError] = useState(false);
  const [usernameTarget, setUsernameTarget] = useState<CompanyUser | null>(null);
  const [usernameValue, setUsernameValue] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  
  const isAdmin = me?.role === 'admin';
  const seatsAvailable = overview ? overview.subscription.seats - overview.seatsUsed : 0;
  const canInvite = isAdmin && seatsAvailable > 0;

  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "staff" },
  });

  async function onInvite(values: z.infer<typeof inviteSchema>) {
    try {
      const res = await inviteMutation.mutateAsync({ data: values });
      queryClient.invalidateQueries({ queryKey: getListCompanyUsersQueryKey() });
      setInviteResult({ code: res.inviteCode, email: values.email, emailSent: res.emailSent, expiresAt: res.inviteCodeExpiresAt });
      form.reset();
    } catch (e) {
      console.error(e);
    }
  }

  const handleUpdateRole = async (userId: string, role: "admin" | "manager" | "staff" | "readonly") => {
    try {
      await updateMutation.mutateAsync({ userId, data: { role } });
      queryClient.invalidateQueries({ queryKey: getListCompanyUsersQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleActive = async (userId: string, active: boolean) => {
    try {
      await updateMutation.mutateAsync({ userId, data: { active } });
      queryClient.invalidateQueries({ queryKey: getListCompanyUsersQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  const openUsernameDialog = (user: CompanyUser) => {
    setUsernameTarget(user);
    setUsernameValue(user.username ?? "");
    setUsernameError(null);
  };

  const handleSaveUsername = async () => {
    if (!usernameTarget) return;
    const trimmed = usernameValue.trim().toLowerCase();
    if (trimmed && !/^[a-z0-9._-]{1,32}$/.test(trimmed)) {
      setUsernameError("Use only lowercase letters, numbers, dots, underscores and hyphens (max 32 characters).");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        userId: usernameTarget.id,
        data: { username: trimmed === "" ? null : trimmed },
      });
      queryClient.invalidateQueries({ queryKey: getListCompanyUsersQueryKey() });
      setUsernameTarget(null);
    } catch (e: unknown) {
      const data = (e as { data?: { error?: string } })?.data;
      setUsernameError(data?.error ?? "Could not save the username. Please try again.");
    }
  };

  const copyInvite = () => {
    if (inviteResult) {
      navigator.clipboard.writeText(inviteResult.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const inviteCodeQuery = useGetInviteCode(inviteCodeTarget?.id ?? "", {
    query: {
      queryKey: getGetInviteCodeQueryKey(inviteCodeTarget?.id ?? ""),
      enabled: inviteCodeTarget !== null,
    },
  });
  const regenerateMutation = useRegenerateInviteCode();

  const handleRegenerateCode = async () => {
    if (!inviteCodeTarget) return;
    setRegenError(false);
    try {
      const res = await regenerateMutation.mutateAsync({ userId: inviteCodeTarget.id });
      queryClient.invalidateQueries({ queryKey: getGetInviteCodeQueryKey(inviteCodeTarget.id) });
      setRegenResult({ email: res.email, emailSent: res.emailSent });
    } catch (e) {
      console.error(e);
      setRegenResult(null);
      setRegenError(true);
    }
  };

  const copyPendingCode = () => {
    const code = inviteCodeQuery.data?.inviteCode;
    if (code) {
      navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'active': return <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">Active</Badge>;
      case 'invited': return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400">Invited</Badge>;
      case 'deactivated': return <Badge variant="outline" className="text-muted-foreground">Deactivated</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <PortalLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-serif text-foreground">Team Management</h1>
          <p className="text-muted-foreground mt-1">Manage access to the RentNotice Pro desktop software.</p>
        </div>

        {isAdmin && (
          <Dialog open={inviteDialogOpen} onOpenChange={(open) => {
            setInviteDialogOpen(open);
            if (!open) setInviteResult(null);
          }}>
            <DialogTrigger asChild>
              <Button disabled={!canInvite}>
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Invite a colleague by email and role. You'll get a single-use
                  invite code they enter in the RentNotice Pro desktop software.
                </DialogDescription>
              </DialogHeader>

              {inviteResult ? (
                <div className="py-4 space-y-4">
                  <Alert className="bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-900/50">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <AlertDescription className="text-green-800 dark:text-green-300">
                      {inviteResult.emailSent
                        ? `Invite code emailed to ${inviteResult.email}.`
                        : `Invitation created for ${inviteResult.email}, but the email could not be sent. Share the code below instead.`}
                    </AlertDescription>
                  </Alert>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      {inviteResult.emailSent ? "Or share this invite code directly:" : "Share this invite code directly:"}
                    </label>
                    <div className="flex gap-2">
                      <Input readOnly value={inviteResult.code} className="font-mono text-sm tracking-wider" />
                      <Button variant="secondary" onClick={copyInvite} className="shrink-0">
                        {copied ? "Copied" : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      They enter this code in the desktop software to set up their account. It can only be used once
                      and expires on {format(new Date(inviteResult.expiresAt), 'MMM d, yyyy')}.
                    </p>
                  </div>
                  <Button className="w-full mt-4" onClick={() => {setInviteResult(null); setInviteDialogOpen(false);}}>Done</Button>
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onInvite)} className="space-y-4 py-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl><Input placeholder="colleague@company.com" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="admin">Admin (Can manage billing & users)</SelectItem>
                              <SelectItem value="manager">Manager (Can manage all notices)</SelectItem>
                              <SelectItem value="staff">Staff (Standard user)</SelectItem>
                              <SelectItem value="readonly">Read-only (Cannot create notices)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter className="pt-4">
                      <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={inviteMutation.isPending}>
                        {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!isAdmin && (
        <Alert className="mb-6">
          <Shield className="h-4 w-4" />
          <AlertDescription>You have read-only access to this page. Only Admins can manage team members.</AlertDescription>
        </Alert>
      )}

      {overview && isAdmin && seatsAvailable <= 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>You have reached your seat limit ({overview.subscription.seats}). Please manage your billing to upgrade your plan before inviting more users.</AlertDescription>
        </Alert>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-0 border-b">
          <CardTitle className="text-lg">Team Directory</CardTitle>
          <CardDescription className="pb-4">
            {overview && `Using ${overview.seatsUsed} of ${overview.subscription.seats} available seats.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id} className={user.status === 'deactivated' ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="font-medium text-foreground">{user.name || "Pending..."}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                      {user.username && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Desktop username: <span className="font-mono">{user.username}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {user.isMasterAdmin && <Shield className="w-3.5 h-3.5 text-primary" />}
                        <span className="capitalize">{user.role}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(user.status)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.createdAt ? format(new Date(user.createdAt), 'MMM d, yyyy') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {isAdmin ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {user.status === 'invited' && (
                              <DropdownMenuItem onClick={() => setInviteCodeTarget(user)}>View invite code…</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openUsernameDialog(user)}>Set desktop username…</DropdownMenuItem>
                            {!user.isMasterAdmin && user.id !== me?.id && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>Change Role</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => handleUpdateRole(user.id, "admin")}>Admin</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdateRole(user.id, "manager")}>Manager</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdateRole(user.id, "staff")}>Staff</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdateRole(user.id, "readonly")}>Read-only</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {user.status === 'deactivated' ? (
                                  <DropdownMenuItem onClick={() => handleToggleActive(user.id, true)}>Reactivate User</DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleToggleActive(user.id, false)}>Deactivate User</DropdownMenuItem>
                                )}
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {user.isMasterAdmin ? "Master Admin" : "Cannot edit"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {users?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No team members found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteCodeTarget !== null} onOpenChange={(open) => { if (!open) { setInviteCodeTarget(null); setCodeCopied(false); setRegenResult(null); setRegenError(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Code</DialogTitle>
            <DialogDescription>
              {inviteCodeTarget && (
                <>Share this single-use code with {inviteCodeTarget.email}. They enter it in the RentNotice Pro desktop software to set up their account.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {regenResult && (
              <Alert className="bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-900/50">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-800 dark:text-green-300">
                  {regenResult.emailSent
                    ? `New code generated and emailed to ${regenResult.email}.`
                    : `New code generated, but the email could not be sent. Copy the code below and share it with ${regenResult.email}.`}
                </AlertDescription>
              </Alert>
            )}
            {regenError && (
              <Alert variant="destructive">
                <AlertDescription>
                  Could not generate a new code. Please try again.
                </AlertDescription>
              </Alert>
            )}
            {inviteCodeQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : inviteCodeQuery.data ? (
              <>
                <div className="flex gap-2">
                  <Input readOnly value={inviteCodeQuery.data.inviteCode} className="font-mono text-sm tracking-wider" />
                  <Button variant="secondary" onClick={copyPendingCode} className="shrink-0">
                    {codeCopied ? "Copied" : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                {inviteCodeQuery.data.inviteCodeExpiresAt && (
                  new Date(inviteCodeQuery.data.inviteCodeExpiresAt).getTime() <= Date.now() ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        This code expired on {format(new Date(inviteCodeQuery.data.inviteCodeExpiresAt), 'MMM d, yyyy')} and can no longer be redeemed. Generate a new code below.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Expires on {format(new Date(inviteCodeQuery.data.inviteCodeExpiresAt), 'MMM d, yyyy')}.
                    </p>
                  )
                )}
              </>
            ) : (
              <p className="text-sm text-destructive">
                Could not load the invite code. The invitation may have already been used.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Need a fresh code? Generating a new one immediately invalidates the old code.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleRegenerateCode} disabled={regenerateMutation.isPending}>
              {regenerateMutation.isPending ? "Generating..." : "Generate New Code"}
            </Button>
            <Button type="button" onClick={() => { setInviteCodeTarget(null); setCodeCopied(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usernameTarget !== null} onOpenChange={(open) => { if (!open) setUsernameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desktop Username</DialogTitle>
            <DialogDescription>
              {usernameTarget && (
                <>Choose the username {usernameTarget.name || usernameTarget.email} types to sign in to the RentNotice Pro desktop software. Leave blank to use an automatic one based on their email.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              value={usernameValue}
              onChange={(e) => { setUsernameValue(e.target.value); setUsernameError(null); }}
              placeholder={usernameTarget ? (usernameTarget.email.split("@")[0] ?? "").toLowerCase() : "username"}
              className="font-mono"
              maxLength={32}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSaveUsername(); } }}
            />
            {usernameError && (
              <p className="text-sm text-destructive">{usernameError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, dots, underscores and hyphens only. They can always sign in with their email address too.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUsernameTarget(null)}>Cancel</Button>
            <Button type="button" onClick={handleSaveUsername} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}

// Need CheckCircle for the success alert above
import { CheckCircle } from "lucide-react";
