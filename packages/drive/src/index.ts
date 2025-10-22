import { GoogleAuth } from "google-auth-library";
import { drive_v3 } from "@googleapis/drive";
import { docs_v1 } from "@googleapis/docs";
import { z } from "zod";

export interface DriveConfig {
  rootFolderId?: string;
  projectId?: string;
  serviceAccountEmail?: string;
  serviceAccountKeyBase64?: string;
}

export interface DriveDocResult {
  fileId: string;
  link: string;
  name: string;
  folderId: string;
}

const templatePathSchema = z.object({
  account: z.string(),
  project: z.string(),
  title: z.string(),
  date: z.string()
});

const decodeServiceAccount = (key?: string) => {
  if (!key) return undefined;
  try {
    return JSON.parse(Buffer.from(key, "base64").toString("utf-8"));
  } catch (error) {
    throw new Error("GOOGLE_SA_KEY_JSON_BASE64 が不正です。");
  }
};

const buildDocName = (input: z.input<typeof templatePathSchema>) => {
  const parsed = templatePathSchema.parse(input);
  return `Clients/${parsed.account}/10_Project/Meetings/${parsed.date}_${parsed.title}.docx`;
};

export class DriveService {
  private readonly auth: GoogleAuth | null;
  private readonly driveClient: drive_v3.Drive | null;
  private readonly docsClient: docs_v1.Docs | null;
  private readonly mockStore = new Map<string, DriveDocResult>();

  constructor(private readonly config: DriveConfig) {
    const creds = decodeServiceAccount(config.serviceAccountKeyBase64);
    if (creds && config.serviceAccountEmail) {
      this.auth = new GoogleAuth({
        credentials: creds,
        projectId: config.projectId,
        scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/documents"]
      });
      this.driveClient = new drive_v3.Drive({ auth: this.auth as unknown as string });
      this.docsClient = new docs_v1.Docs({ auth: this.auth as unknown as string });
    } else {
      this.auth = null;
      this.driveClient = null;
      this.docsClient = null;
    }
  }

  async createMeetingDoc(params: {
    account: string;
    project: string;
    title: string;
    templateId?: string;
    content?: string;
    date: string;
  }): Promise<DriveDocResult> {
    const name = buildDocName(params);
    if (!this.driveClient || !this.docsClient) {
      const mockId = `mock_${Math.random().toString(36).slice(2)}`;
      const record: DriveDocResult = {
        fileId: mockId,
        link: `https://drive.mock/${mockId}`,
        name,
        folderId: "mock-folder"
      };
      this.mockStore.set(mockId, record);
      return record;
    }

    const folderId = await this.ensureFolder(name);
    const file = await this.driveClient.files.copy({
      fileId: params.templateId ?? "root",
      requestBody: {
        name: name.split("/").pop() ?? params.title,
        parents: [folderId]
      }
    });

    if (!file.data.id) {
      throw new Error("Google Drive ファイル作成に失敗しました。");
    }

    if (params.content) {
      await this.docsClient.documents.batchUpdate({
        documentId: file.data.id,
        requestBody: {
          requests: [
            {
              insertText: {
                text: params.content,
                endOfSegmentLocation: {}
              }
            }
          ]
        }
      });
    }

    return {
      fileId: file.data.id,
      link: `https://docs.google.com/document/d/${file.data.id}`,
      name,
      folderId
    };
  }

  async moveDoc(fileId: string, newFolderId: string): Promise<void> {
    if (!this.driveClient) {
      const existing = this.mockStore.get(fileId);
      if (!existing) {
        throw new Error("mock doc not found");
      }
      existing.folderId = newFolderId;
      return;
    }

    await this.driveClient.files.update({
      fileId,
      addParents: newFolderId
    });
  }

  private async ensureFolder(path: string): Promise<string> {
    if (!this.driveClient) {
      return "mock-folder";
    }

    const segments = path.split("/").slice(0, -1);
    let parent = this.config.rootFolderId;
    for (const segment of segments) {
      const q = [`name='${segment.replace("'", "\\'")}'`, "mimeType='application/vnd.google-apps.folder'"].join(" and ");
      const res = await this.driveClient.files.list({
        q: parent ? `${q} and '${parent}' in parents` : q,
        fields: "files(id, name)",
        spaces: "drive"
      });
      const existing = res.data.files?.[0];
      if (existing?.id) {
        parent = existing.id;
        continue;
      }

      const created = await this.driveClient.files.create({
        requestBody: {
          name: segment,
          mimeType: "application/vnd.google-apps.folder",
          parents: parent ? [parent] : undefined
        },
        fields: "id"
      });

      if (!created.data.id) {
        throw new Error(`フォルダ ${segment} の作成に失敗しました。`);
      }
      parent = created.data.id;
    }

    if (!parent) {
      throw new Error("ルートフォルダを特定できません。");
    }
    return parent;
  }
}
