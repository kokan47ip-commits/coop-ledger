// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";
import { passwordVerifyEmail, passwordResetEmail } from "./auth/passwordEmails";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    emailOtp,
    Anonymous,
    // Traditional email + password sign-in. Passwords are hashed (Scrypt) and
    // stored by Convex Auth. Reset codes reuse the same email delivery as the
    // sign-in OTP.
    //
    // NOTE: no `verify` provider on purpose. With `verify` set, sign-up does
    // not sign the user in — it parks the account in an unverified state
    // (result.signingIn === false) until a 6-digit emailed code is entered,
    // so a freshly chosen password would fail on the next sign-in attempt
    // until that extra step completed. Without `verify`, "Create an account"
    // signs in immediately with the user-defined password (password reset is
    // still available and proves email ownership for recovery).
    Password({
      reset: passwordResetEmail,
      validatePasswordRequirements: (password: string) => {
        if (password.length < 8 || !/\d/.test(password)) {
          throw new Error(
            "Password must be at least 8 characters and contain a number.",
          );
        }
      },
    }),
  ],
});
