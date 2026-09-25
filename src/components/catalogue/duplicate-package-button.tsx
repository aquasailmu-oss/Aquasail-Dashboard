"use client";

import { CopyIcon } from "lucide-react";

import { useTransition } from "react";
import { toast } from "sonner";
import { duplicatePackage } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";
import { openAfterSave } from "@/lib/navigate";

export function DuplicatePackageButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={`Duplicate ${name}`}
      onClick={() => {
        const formData = new FormData();
        formData.set("id", id);
        startTransition(async () => {
          const result = await duplicatePackage(formData);
          if (!result.ok) return void toast.error(result.error);
          openAfterSave(`/admin/packages/${result.data.id}`); // the copy opens off sale
        });
      }}
    >
      <CopyIcon />
      Duplicate
    </Button>
  );
}
