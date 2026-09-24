"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/roles";

const ORDER: Role[] = ["receptionist", "accountant", "activity_staff", "admin"];

export function RoleSelect({ id, defaultValue, disabled }: { id: string; defaultValue?: Role; disabled?: boolean }) {
  return (
    <Select name="role" defaultValue={defaultValue} disabled={disabled} required>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose a role" />
      </SelectTrigger>
      <SelectContent>
        {ORDER.map((role) => (
          <SelectItem key={role} value={role} description={ROLE_DESCRIPTIONS[role]}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
