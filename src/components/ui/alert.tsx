import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-md border-l-4 px-4 py-3 text-base", {
  variants: {
    variant: {
      default: "border-accent-foreground bg-info-surface text-foreground",
      success: "border-success bg-success-surface text-foreground",
      warning: "border-warning bg-warning-surface text-foreground",
      destructive: "border-destructive bg-destructive-surface text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("font-semibold", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
