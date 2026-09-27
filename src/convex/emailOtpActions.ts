"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendCode } from "./auth/passwordEmails";

/**
 * Sends the 6-digit code used by the login page's "First login? Set your
 * password" flow. The code is stored by an internal mutation (as a normal
 * email-OTP verification code — any live code for the email proves ownership,
 * see memberPortal.setPasswordWithOtp) and then emailed here, because only an
 * action can reach the mail endpoint. No account is required, so members who
 * have never signed up can receive their code too.
 */
export const sendPasswordSetupCode = action({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new Error("Enter a valid email address.");
    }
    const { code } = await ctx.runMutation(internal.memberPortal.pwSetupPrepare, {
      email: normalized,
    });
    await sendCode(normalized, code);
    return { sent: true as const };
  },
});
