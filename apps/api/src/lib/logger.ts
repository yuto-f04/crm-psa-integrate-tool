import pino from "pino";
import { createRedactor } from "@crm-psa/security";
import { mustLoadConfig } from "@crm-psa/config";

const redact = createRedactor(["body.payload.contact.email"]);

export const logger = pino({
  level: mustLoadConfig().NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: ["req.headers.authorization"],
    censor: "***"
  },
  formatters: {
    log(object) {
      return JSON.parse(redact(object));
    }
  }
});
