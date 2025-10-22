import { z } from "zod";

export const roleSchema = z.enum(["EXEC", "PM", "FIN", "DEV", "QA", "CS", "CLIENT"]);

export type RoleCode = z.infer<typeof roleSchema>;

export const ROLE_PRIORITY: Record<RoleCode, number> = {
  EXEC: 6,
  PM: 5,
  FIN: 4,
  DEV: 3,
  QA: 2,
  CS: 1,
  CLIENT: 0
};

export const actionSchema = z.enum([
  "meetings:read",
  "meetings:route",
  "docs:approve",
  "docs:review",
  "issues:update",
  "issues:review",
  "admin:integrations",
  "admin:security"
]);

export type ActionCode = z.infer<typeof actionSchema>;

export const ROLE_PERMISSIONS: Record<RoleCode, ActionCode[]> = {
  EXEC: ["meetings:read", "meetings:route", "docs:approve", "docs:review", "issues:update", "issues:review", "admin:integrations", "admin:security"],
  PM: ["meetings:read", "meetings:route", "docs:approve", "docs:review", "issues:update", "issues:review"],
  FIN: ["meetings:read", "docs:review"],
  DEV: ["meetings:read", "issues:update"],
  QA: ["meetings:read", "issues:review"],
  CS: ["meetings:read"],
  CLIENT: ["meetings:read"]
};

export const hasPermission = (role: RoleCode, action: ActionCode) => {
  return ROLE_PERMISSIONS[role]?.includes(action) ?? false;
};

export const meetingStatusSchema = z.enum(["CAPTURED", "ROUTED", "APPROVED", "FINALIZED"]);
export const docStatusSchema = z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]);
export const issueStatusSchema = z.enum(["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"]);

export type MeetingStatus = z.infer<typeof meetingStatusSchema>;
export type DocStatus = z.infer<typeof docStatusSchema>;
export type IssueStatus = z.infer<typeof issueStatusSchema>;

export const undoWindowHours = 24;

export interface RoutingCandidate {
  client: string;
  project: string;
  confidence: number;
}

export interface DaraItem {
  kind: "decision" | "assumption" | "risk" | "action";
  title: string;
  detail?: string;
  confidence: number;
}

export const i18nDictionary = {
  "common.approve": "承認",
  "common.reject": "却下",
  "common.retry": "再試行",
  "meeting.awaitingApproval": "承認待ちの議事録",
  "meeting.autoApproved": "自動承認済み",
  "meeting.needsReview": "承認が必要です",
  "meeting.pending": "保留",
  "slack.approval.title": "議事録承認リクエスト",
  "slack.approval.approved": "Drive移動とDB確定が完了しました。",
  "slack.approval.failed": "Drive移動に失敗しました。DBは更新されていません。",
  "board.status.backlog": "バックログ",
  "board.status.inProgress": "進行中",
  "board.status.review": "レビュー",
  "board.status.done": "完了",
  "integrations.unconfigured": "未接続",
  "integrations.connected": "接続済み"
} as const;

export type DictionaryKey = keyof typeof i18nDictionary;

export const t = (key: DictionaryKey): string => i18nDictionary[key] ?? key;
