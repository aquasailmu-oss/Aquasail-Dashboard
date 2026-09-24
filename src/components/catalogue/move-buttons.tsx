"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { moveActivity } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";

export function MoveButtons({ id, name, first, last }: { id: string; name: string; first: boolean; last: boolean }) {
  const [pending, startTransition] = useTransition();
  const move = (direction: "up" | "down") => {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("direction", direction);
    startTransition(async () => {
      const result = await moveActivity(formData);
      if (!result.ok) toast.error(result.error);
    });
  };
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={first || pending}
        aria-label={`Move ${name} up`}
        onClick={() => move("up")}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={last || pending}
        aria-label={`Move ${name} down`}
        onClick={() => move("down")}
      >
        <ArrowDownIcon />
      </Button>
    </div>
  );
}
