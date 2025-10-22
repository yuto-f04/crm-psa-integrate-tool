
import crypto from "node:crypto";
import { WebClient } from "@slack/web-api";
import { z } from "zod";

export interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
  interactionsUrl?: string;
}

export interface SlackApprovalPayload {
  orgId: string;
  meetingId: string;
  docId: string;
  routedClient?: string;
  routedProject?: string;
  confidence?: number;
  approverRole: string;
}

export const buildApprovalBlocks = (payload: SlackApprovalPayload) => {
  const actionValue = {
    meetingId: payload.meetingId,
    docId: payload.docId,
    orgId: payload.orgId
  };

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*議事録承認リクエスト*\n案件: ${payload.routedClient ?? "未分類"} / ${payload.routedProject ?? "-"}`
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Confidence: ${(payload.confidence ?? 0).toFixed(2)}`
        }
      ]
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "承認"
          },
          style: "primary",
          value: JSON.stringify({ ...actionValue, action: "approve" })
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "保留"
          },
          style: "danger",
          value: JSON.stringify({ ...actionValue, action: "hold" })
        }
      ]
    }
  ];
};

export class SlackSigner {
  constructor(private readonly signingSecret: string) {}

  verify(timestamp: string, signature: string, rawBody: string) {
    const version = "v0";
    const basestring = `${version}:${timestamp}:${rawBody}`;
    const computed = `${version}=${crypto.createHmac("sha256", this.signingSecret).update(basestring).digest("hex")}`;
    const computedBuffer = Buffer.from(computed, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");
    if (computedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(computedBuffer, signatureBuffer)) {
      throw new Error("Slack署名の検証に失敗しました。");
    }
  }
}

export class SlackService {
  private readonly client: WebClient | null;
  private readonly signer: SlackSigner | null;

  constructor(private readonly config: SlackConfig) {
    this.client = config.botToken ? new WebClient(config.botToken) : null;
    this.signer = config.signingSecret ? new SlackSigner(config.signingSecret) : null;
  }

  verifyRequest(headers: Record<string, string>, rawBody: string) {
    if (!this.signer) return;
    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];
    if (!timestamp || !signature) {
      throw new Error("Slack署名ヘッダーが不足しています。");
    }
    this.signer.verify(timestamp, signature, rawBody);
  }

  async postApproval(channel: string, payload: SlackApprovalPayload, text = "承認リクエスト"): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.chat.postMessage({
      channel,
      text,
      blocks: buildApprovalBlocks(payload)
    });
  }
}

export const slackInteractionSchema = z.object({
  type: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string()
  }),
  actions: z.array(
    z.object({
      value: z.string()
    })
  ),
  response_url: z.string().url()
});
