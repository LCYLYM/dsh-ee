import type zh from "../zh";
import type { Messages } from "../types";
import common from "./common";
import config from "./config";
import infra from "./infra";
import ops from "./ops";
import llm_admin from "./llm-admin";
import menus_admin from "./menus-admin";
import access from "./access";
import landing from "./landing";
import distribution from "./distribution";
import market from "./market";
import portal from "./portal";
import keys from "./keys";
import auth from "./auth";
import registry from "./registry";

export default {
  ...common,
  ...config,
  ...infra,
  ...ops,
  ...llm_admin,
  ...menus_admin,
  ...access,
  ...landing,
  ...distribution,
  ...market,
  ...portal,
  ...keys,
  ...auth,
  ...registry,
} satisfies Messages<typeof zh>;
