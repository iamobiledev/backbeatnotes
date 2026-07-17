import { Suspense } from "react";
import { getGoogleAuthConfig } from "@/env/server";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  const googleEnabled = Boolean(getGoogleAuthConfig());

  return (
    <Suspense>
      <SignInForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
