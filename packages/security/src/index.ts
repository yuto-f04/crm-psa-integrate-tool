import fastRedact from "fast-redact";
import jwt, { type SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import argon2 from "argon2";
import net from "node:net";
import { roleSchema, type RoleCode, hasPermission, type ActionCode } from "@crm-psa/core";
import { z } from "zod";

export interface JwtPayload {
  sub: string;
  orgId: string;
  roles: RoleCode[];
  iat?: number;
  exp?: number;
}

export const signJwt = (payload: JwtPayload, secret: string, options: SignOptions = {}) =>
  jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: "1h",
    ...options
  });

export const verifyJwt = (token: string, secret: string): JwtPayload => {
  const decoded = jwt.verify(token, secret, {
    algorithms: ["HS256"]
  });
  return JwtSchema.parse(decoded);
};

const JwtSchema = z.object({
  sub: z.string(),
  orgId: z.string(),
  roles: z.array(roleSchema)
});

export const createRequestId = () => nanoid(12);

export const createRedactor = (additional: string[] = []) =>
  fastRedact({
    paths: ["email", "payload.email", "metadata.email", "body.password", ...additional],
    censor: "***"
  });

export const ensurePermission = (roles: RoleCode[], action: ActionCode) => {
  if (!roles.some((role) => hasPermission(role, action))) {
    const err = new Error("権限がありません。");
    err.name = "ForbiddenError";
    throw err;
  }
};

export const hashPassword = async (plain: string) => argon2.hash(plain, { type: argon2.argon2id });
export const verifyPassword = async (plain: string, hash: string) => argon2.verify(hash, plain);

export interface ClamAVOptions {
  host: string;
  port: number;
  enabled: boolean;
}

export class ClamAVScanner {
  constructor(private readonly opts: ClamAVOptions) {}

  async scan(buffer: Buffer): Promise<void> {
    if (!this.opts.enabled) return;
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.opts.host, port: this.opts.port }, () => {
        socket.write("zINSTREAM\0");
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buffer.length, 0);
        socket.write(size);
        socket.write(buffer);
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (data) => {
        const text = data.toString();
        if (text.includes("OK")) {
          socket.end();
          resolve();
        } else {
          socket.destroy();
          reject(new Error(`ウイルス検知: ${text}`));
        }
      });
      socket.on("error", (err) => reject(err));
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("ClamAV との通信がタイムアウトしました"));
      });
    });
  }
}

export const parseOrgId = (headerValue?: string): string => {
  if (!headerValue) {
    throw new Error("x-org-id ヘッダーが必要です。");
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(headerValue)) {
    throw new Error("x-org-id ヘッダーが不正です。");
  }
  return headerValue;
};
