"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!bg-card !text-foreground !border-border !text-base !font-sans",
          description: "!text-muted-foreground",
          success: "!border-l-4 !border-l-success",
          error: "!border-l-4 !border-l-destructive",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
