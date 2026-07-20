"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export function SignOutButtons() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await signOut();
            router.push("/sign-in");
            router.refresh();
          });
        }}
      >
        Sign out
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            // Revoke remaining sessions first. If this fails, other devices
            // would stay signed in, so surface the error and abort instead of
            // silently signing out only this device.
            let revoked: Response;
            try {
              revoked = await fetch("/api/auth/revoke-sessions", {
                method: "POST",
                credentials: "include",
              });
            } catch {
              toast.error(
                "Couldn't reach the server to sign out your other devices. Please try again.",
              );
              return;
            }
            if (!revoked.ok) {
              toast.error(
                "Couldn't sign out your other devices. Please try again.",
              );
              return;
            }
            await signOut({
              fetchOptions: {
                onSuccess: () => {
                  router.push("/sign-in");
                },
              },
            });
            router.push("/sign-in");
            router.refresh();
          });
        }}
      >
        Sign out all devices
      </Button>
    </div>
  );
}
