"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateUser } from "@/actions/users";
import { RoleSelect } from "@/components/admin/role-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Role } from "@/lib/roles";
import { useServerForm } from "@/lib/use-server-form";

type EditableUser = { id: string; email: string; full_name: string; role: Role; is_active: boolean };

export function EditUserDialog({ user, isSelf }: { user: EditableUser; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit, reset } = useServerForm(updateUser, {
    onSuccess: () => {
      setOpen(false);
      toast.success(`Saved ${user.email}.`);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Edit ${user.full_name}`}>
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.full_name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
          <input type="hidden" name="user_id" value={user.id} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`name-${user.id}`}>Full name</Label>
            <Input id={`name-${user.id}`} name="full_name" defaultValue={user.full_name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`role-${user.id}`}>Role</Label>
            {/* A disabled Select does not submit, so the current value is posted alongside. */}
            {isSelf && <input type="hidden" name="role" value={user.role} />}
            <RoleSelect id={`role-${user.id}`} defaultValue={user.role} disabled={isSelf} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`active-${user.id}`}>Access</Label>
            {isSelf && <input type="hidden" name="is_active" value="true" />}
            <Select name="is_active" defaultValue={String(user.is_active)} disabled={isSelf}>
              <SelectTrigger id={`active-${user.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active: can sign in and work</SelectItem>
                <SelectItem value="false">Deactivated: blocked everywhere</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isSelf && <Alert>You cannot change your own role or deactivate yourself. Another admin can.</Alert>}
          <p className="text-muted-foreground text-sm">
            Users are never deleted. A deactivated user keeps their name on past bookings and in the audit log.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
