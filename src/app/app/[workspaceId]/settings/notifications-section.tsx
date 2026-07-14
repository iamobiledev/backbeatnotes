"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { actionSetEmailNotifications } from "@/app/actions";

export function NotificationsSection({ enabled }: { enabled: boolean }) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [, startTransition] = useTransition();

  const toggle = () => {
    const next = !isEnabled;
    setIsEnabled(next);
    startTransition(async () => {
      const result = await actionSetEmailNotifications({ enabled: next });
      if (result.ok) {
        toast.success(
          next
            ? "Email notifications on — you'll hear about changes to your pages."
            : "Email notifications off.",
        );
      } else {
        setIsEnabled(!next);
        toast.error(result.error);
      }
    });
  };

  return (
    <section aria-labelledby="notifications-heading">
      <h2
        id="notifications-heading"
        className="flex items-center gap-2 text-lg font-medium"
      >
        <BellRing className="h-4 w-4 text-[var(--muted-foreground)]" />
        Notifications
      </h2>
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Email me about page changes</p>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              When someone edits a page you created or worked on — at most one
              email per page every few hours.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            aria-label="Email me about page changes"
            onClick={toggle}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              isEnabled ? "bg-[var(--primary)]" : "bg-[var(--muted)]"
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                isEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
