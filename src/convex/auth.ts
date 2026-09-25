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
    // stored by Convex Auth. Verification and reset codes reuse the same email
    // delivery as the sign-in OTP. Without `verify`, an existing email-OTP
    // account is linked to the password account on first password sign-in.
    Password({
      verify: passwordVerifyEmail,
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
