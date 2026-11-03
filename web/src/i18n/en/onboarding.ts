import type zh from "../zh/onboarding";
import type { Messages } from "../types";

export default {
  onboarding: {
    title: "First-time setup guide",
    desc: "Complete the required configuration in order. Finished steps are skipped automatically.",
    optional: "Optional",
    done: "Done",
    next: "Next",
    handle: "Configure",
    publish: "Publish connect plugin",
    publishing: "Publishing…",
    published: "Connect plugin {{version}} published",
    inviteTitle: "Invite employees to connect",
    inviteDesc: "After the required steps, share this command with employees. They can also install Desktop from the download page.",
  },
} satisfies Messages<typeof zh>;
