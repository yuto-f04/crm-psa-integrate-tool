import { config as loadEnv } from "dotenv";
import { z } from "zod";

const bool = z
  .string()
  .transform((val) => val.toLowerCase())
  .transform((val) => ["1", "true", "on", "yes"].includes(val))
  .or(z.boolean());

const numberFromString = z
  .string()
  .transform((val) => Number.parseInt(val, 10))
  .or(z.number());

const envSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  AUTH_JWT_SECRET: z.string().min(10),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_INTERACTIONS_URL: z.string().optional(),
  ALERT_SLACK_CHANNEL: z.string().default("#alerts"),
  ESCALATE_24H_HANDLE: z.string().default("@pm"),
  ESCALATE_48H_HANDLE: z.string().default("@exec"),

  GOOGLE_PROJECT_ID: z.string().optional(),
  GOOGLE_SA_EMAIL: z.string().optional(),
  GOOGLE_SA_KEY_JSON_BASE64: z.string().optional(),
  GOOGLE_DRIVE_ROOT_ID: z.string().optional(),

  TLDV_WEBHOOK_SECRET: z.string().optional(),
  TLDV_WEBHOOK_URL: z.string().optional(),

  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_FROM: z.string().default("no-reply@example.com"),
  SENDGRID_API_KEY: z.string().optional(),

  MF_CLIENT_ID: z.string().optional(),
  MF_CLIENT_SECRET: z.string().optional(),
  MF_OAUTH_CALLBACK_URL: z.string().optional(),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_PRIVATE_KEY_BASE64: z.string().optional(),

  LLM_AUTO_APPROVE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  LLM_REVIEW_MIN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

  SLO_API_P95_MS: z.coerce.number().default(500),
  SLO_AVAILABILITY_PCT: z.coerce.number().min(0).max(100).default(99),
  ALERT_PENDING_DOCS_24H: z.coerce.number().default(3),
  ALERT_QUEUE_LAG_SEC: z.coerce.number().default(300),
  ALERT_WEBHOOK_FAIL_PCT: z.coerce.number().default(5),

  AUDIT_LOG_RETENTION_DAYS: numberFromString.default(90),
  DB_BACKUP_PITR_DAYS: numberFromString.default(7),
  PII_DELETE_SLA_DAYS: numberFromString.default(30),
  DATA_RESIDENCY_REGION: z.string().default("ap-northeast-1"),

  HTTP_CLIENT_TIMEOUT_MS: numberFromString.default(10000),
  RETRY_BACKOFF_BASE_MS: numberFromString.default(500),
  RETRY_BACKOFF_MAX_MS: numberFromString.default(10000),
  RETRY_MAX_ATTEMPTS: numberFromString.default(5),

  RATE_LIMIT_RPS_SLACK: numberFromString.default(10),
  RATE_LIMIT_RPS_DRIVE: numberFromString.default(5),
  RATE_LIMIT_RPS_MF: numberFromString.default(3),
  RATE_LIMIT_RPS_GITHUB: numberFromString.default(5),

  APM_TRACE_RETENTION_DAYS: numberFromString.default(3),
  LOG_SAMPLING_RATIO: z.coerce.number().min(0).max(1).default(1),
  LLM_MONTHLY_COST_LIMIT_USD: z.coerce.number().default(200),
  EXTERNAL_API_COST_LIMIT_USD: z.coerce.number().default(500),

  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  CSP_DEFAULT_SRC: z.string().default("'self'"),
  CSP_IMG_SRC: z.string().default("'self' data:"),
  CSP_SCRIPT_SRC: z.string().default("'self'"),
  CSRF_MODE: z.enum(["double-submit", "header", "none"]).default("double-submit"),

  UPLOAD_MAX_MB: numberFromString.default(25),
  UPLOAD_ALLOWED_MIME: z.string().default("application/pdf,image/png,image/jpeg"),
  VIRUS_SCAN_ENABLED: bool.default(false),

  DR_RTO_HOURS: numberFromString.default(4),
  DR_RPO_MINUTES: numberFromString.default(15),
  INCIDENT_STOP_ENABLED: bool.default(false),

  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres")).optional(),
  REDIS_URL: z.string().url().or(z.string().startsWith("redis")).optional(),
  DB_POOL_MAX: numberFromString.default(20),

  OTLP_ENDPOINT: z.string().url().default("http://localhost:4318"),

  E2E_PM_EMAIL: z.string().email().default("pm@example.com"),
  E2E_PM_PASSWORD: z.string().default("pm-password")
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedConfig: AppEnv | undefined;

export const loadConfig = (overrides: Partial<Record<keyof AppEnv, string>> = {}): AppEnv => {
  if (cachedConfig) {
    return cachedConfig;
  }

  loadEnv();
  const merged = { ...process.env, ...overrides } as Record<string, string>;
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const formatted = parsed.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join(", ");
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
};

export const mustLoadConfig = (): AppEnv => loadConfig();

export const isProduction = () => mustLoadConfig().NODE_ENV === "production";
