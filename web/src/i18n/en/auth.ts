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
    mismatch: "The new passwords don't match",
  },
} satisfies Messages<typeof zh>;
