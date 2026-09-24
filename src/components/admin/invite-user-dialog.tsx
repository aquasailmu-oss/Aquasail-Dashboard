"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { inviteUser } from "@/actions/users";
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
import { useServerForm } from "@/lib/use-server-form";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const { result, pending, onSubmit, reset } = useServerForm(inviteUser, {
    onSuccess: (email) => {
      setOpen(false);
      toast.success(`Invite sent to ${email}.`);
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
        <Button>
          <PlusIcon />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They get an email with a link to choose a password. The link expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          {result && !result.ok && <Alert variant="destructive">{result.error}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-name">Full name</Label>
            <Input id="invite-name" name="full_name" autoComplete="off" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <RoleSelect id="invite-role" defaultValue="receptionist" />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
