import { getGoogleAuthConfig } from "@/env/server";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Sign up" };

export default function SignUpPage() {
  const googleEnabled = Boolean(getGoogleAuthConfig());

  return <SignUpForm googleEnabled={googleEnabled} />;
}
