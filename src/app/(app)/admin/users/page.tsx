import type { Metadata } from "next";
import { EditUserDialog } from "@/components/admin/edit-user-dialog";
import { InviteUserDialog } from "@/components/admin/invite-user-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users · AquaSail Ops" };

export default async function UsersPage() {
  const me = await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: users, error } = await supabase.rpc("admin_list_users");

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts. Every change here is recorded in the audit log."
        actions={<InviteUserDialog />}
      />
      {error ? (
        <Alert variant="destructive">The user list could not be loaded. Refresh the page to try again.</Alert>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.is_active ? undefined : "text-muted-foreground"}>
                  <TableCell className="font-semibold">
                    {u.full_name}
                    {u.id === me.userId && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                  <TableCell>
                    {!u.is_active ? (
                      <Badge variant="secondary">Deactivated</Badge>
                    ) : u.invite_pending ? (
                      <Badge variant="warning">Invite sent</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "Never"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateShort(new Date(u.created_at))}</TableCell>
                  <TableCell className="text-right">
                    <EditUserDialog user={u} isSelf={u.id === me.userId} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
