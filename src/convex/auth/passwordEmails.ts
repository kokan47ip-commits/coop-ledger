import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Email delivery for the Password provider's verification and reset codes.
 * Uses the same Freebuff transactional endpoint as the sign-in OTP.
 */
async function sendCode(email: string, token: string) {
  try {
    await axios.post(
      "https://auth.freebuff.app/send_otp",
      {
        to: email,
        otp: token,
        appName: process.env.VLY_APP_NAME || "a freebuff.com application",
      },
      {
        headers: {
          "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
        },
      },
    );
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
}

function sixDigitToken() {
  const random: RandomReader = {
    read(bytes: Uint8Array) {
      crypto.getRandomValues(bytes);
    },
  };
  return generateRandomString(random, "0123456789", 6);
}

/** Sent when a password account needs its email verified (sign-up or first sign-in). */
export const passwordVerifyEmail = Email({
  id: "password-verify-email",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return sixDigitToken();
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendCode(email, token);
  },
});

/** Sent when the user requests a password reset. */
export const passwordResetEmail = Email({
  id: "password-reset-email",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    return sixDigitToken();
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendCode(email, token);
  },
});
