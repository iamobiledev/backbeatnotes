"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.011h3.878c2.269-2.09 3.578-5.166 3.578-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.956-1.075 7.942-2.907l-3.878-3.011c-1.075.72-2.45 1.145-4.064 1.145-3.125 0-5.771-2.111-6.715-4.948H1.276v3.11A11.995 11.995 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.285 14.279A7.213 7.213 0 0 1 4.909 12c0-.79.136-1.56.376-2.279V6.611H1.276A11.995 11.995 0 0 0 0 12c0 1.936.464 3.769 1.276 5.389l4.009-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.773c1.762 0 3.344.605 4.587 1.794l3.442-3.442C17.951 1.19 15.235 0 12 0 7.309 0 3.25 2.69 1.276 6.611l4.009 3.11C6.229 6.884 8.875 4.773 12 4.773Z"
      />
    </svg>
  );
}

/**
 * "Continue with Google" — starts the Better Auth Google OAuth flow.
 * Rendered only when the server says Google sign-in is configured.
 */
export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn
          .social({
            provider: "google",
            callbackURL: "/app",
            newUserCallbackURL: "/app",
            errorCallbackURL: "/sign-in",
          })
          .catch(() => setPending(false));
      }}
    >
      <GoogleLogo className="h-4 w-4" />
      {pending ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}

/** "or" divider between Google and the email form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-[var(--border)]" />
      <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
        or
      </span>
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
