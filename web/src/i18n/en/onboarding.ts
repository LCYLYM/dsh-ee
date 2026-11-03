import type zh from "../zh/onboarding";
import type { Messages } from "../types";

export default {
  onboarding: {
    title: "First-time setup guide",
    desc: "Complete the required configuration in order. Finished steps are skipped automatically.",
    kicker: "WELCOME TO DSH-EE",
    heroTitle: "Get your company AI workspace ready",
    heroDesc: "Follow the guided steps to finish your first deployment. Each step has a clear next action, and you will enter the workbench automatically when done.",
    progress: "Setup progress {{done}}/{{total}}",
    requiredLabel: "Required steps",
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
