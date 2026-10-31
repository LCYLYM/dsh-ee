import type zh from "../zh/auth";
import type { Messages } from "../types";

export default {
  login: {
    title: "Sign in to your workbench",
    subtitle: "Use the account your administrator created for you.",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    forgot: "Forgot your password? Ask an administrator to reset it.",
    ldapHint: "You can sign in with your company domain account (same as your computer password).",
    ldapForgot: "Recover your domain password in the company's account system; for a local account, ask an administrator.",
  },
  account: {
    title: "Account",
    logout: "Log out",
    username: "Username",
    displayName: "Display name",
    department: "Department",
    roles: "Roles",
    changePassword: "Change password",
    currentPassword: "Current password",
    newPassword: "New password",
    newPasswordHint: "At least 10 characters. You'll need to sign in again on every device afterwards.",
    confirmPassword: "Repeat the new password",
    source: "Account source",
    sourceLocal: "Local account",
    sourceLdap: "Enterprise directory (LDAP)",
    email: "Email",
    ldapManaged: "Your account is managed by the enterprise directory. Change your password in the company's account system; display name and department sync from the directory at each sign-in.",
    mismatch: "The new passwords don't match",
  },
} satisfies Messages<typeof zh>;
