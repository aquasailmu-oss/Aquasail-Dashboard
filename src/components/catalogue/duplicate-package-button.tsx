"use client";

import { CopyIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { duplicatePackage } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";

export function DuplicatePackageButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
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
          toast.success(`Copied ${name}. The copy is not on sale until you switch it on.`);
          router.push(`/admin/packages/${result.data.id}`);
        });
      }}
    >
      <CopyIcon />
      Duplicate
    </Button>
  );
}
