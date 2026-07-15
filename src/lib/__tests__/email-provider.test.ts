import { describe, expect, it } from "vitest";
import { resolveEmailDeliveryStatus } from "@/lib/email";

describe("email provider resolution", () => {
  it("uses console-only delivery when Resend is completely unset", () => {
    expect(resolveEmailDeliveryStatus({})).toEqual({
      provider: "console",
      delivery: "console-only",
      configured: false,
      missing: ["RESEND_API_KEY", "EMAIL_FROM"],
    });
  });

  it("reports the specific missing setting when partially configured", () => {
    expect(
      resolveEmailDeliveryStatus({ RESEND_API_KEY: "re_test" }),
    ).toMatchObject({
      provider: "console",
      delivery: "console-only",
      missing: ["EMAIL_FROM"],
    });
    expect(
      resolveEmailDeliveryStatus({ EMAIL_FROM: "Docloom <noreply@example.com>" }),
    ).toMatchObject({
      provider: "console",
      delivery: "console-only",
      missing: ["RESEND_API_KEY"],
    });
  });

  it("uses Resend delivery only when both required settings are present", () => {
    expect(
      resolveEmailDeliveryStatus({
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "Docloom <noreply@example.com>",
      }),
    ).toEqual({
      provider: "resend",
      delivery: "resend",
      configured: true,
      missing: [],
    });
  });
});
