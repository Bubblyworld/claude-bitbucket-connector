import * as jose from "jose";
import { config } from "../config.js";
import { refreshToken as refreshBitbucketToken } from "./bitbucket.js";
import type { BitbucketTokens } from "./bitbucket.js";

const JWT_ALG = "HS256";
const ACCESS_TOKEN_TTL = "1h";
const REFRESH_TOKEN_TTL = "24h";
const PENDING_TTL_MS = 5 * 60 * 1000;

let jwtSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (!jwtSecret) {
    jwtSecret = new TextEncoder().encode(config.jwtSecret);
  }
  return jwtSecret;
}

// --- Pending Bitbucket authorization (before BB callback) ---

interface PendingBitbucketAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  createdAt: number;
}

const pendingAuths = new Map<string, PendingBitbucketAuth>();

export function storePendingAuth(
  nonce: string,
  data: Omit<PendingBitbucketAuth, "createdAt">,
): void {
  pendingAuths.set(nonce, { ...data, createdAt: Date.now() });
}

export function consumePendingAuth(
  nonce: string,
): PendingBitbucketAuth | undefined {
  const entry = pendingAuths.get(nonce);
  if (!entry) return undefined;
  pendingAuths.delete(nonce);
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) return undefined;
  return entry;
}

// --- Authorization codes (after BB callback, before /token) ---

interface PendingCodeExchange {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  bitbucketTokens: BitbucketTokens;
  createdAt: number;
}

const pendingCodes = new Map<string, PendingCodeExchange>();

export function storeAuthorizationCode(
  code: string,
  data: Omit<PendingCodeExchange, "createdAt">,
): void {
  pendingCodes.set(code, { ...data, createdAt: Date.now() });
}

export function getPendingCodeChallenge(code: string): string | undefined {
  const entry = pendingCodes.get(code);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) {
    pendingCodes.delete(code);
    return undefined;
  }
  return entry.codeChallenge;
}

export function consumeAuthorizationCode(
  code: string,
): PendingCodeExchange | undefined {
  const entry = pendingCodes.get(code);
  if (!entry) return undefined;
  pendingCodes.delete(code);
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) return undefined;
  return entry;
}

// --- Sessions (BB tokens keyed by session ID) ---

interface BitbucketSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const sessions = new Map<string, BitbucketSession>();

export function createSession(bbTokens: BitbucketTokens): string {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    accessToken: bbTokens.access_token,
    refreshToken: bbTokens.refresh_token,
    expiresAt: Date.now() + bbTokens.expires_in * 1000,
  });
  return sessionId;
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export async function getBitbucketToken(
  sessionId: string,
): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  // Refresh if token expires within 60 seconds
  if (session.expiresAt - Date.now() < 60_000) {
    const fresh = await refreshBitbucketToken(session.refreshToken);
    session.accessToken = fresh.access_token;
    session.refreshToken = fresh.refresh_token;
    session.expiresAt = Date.now() + fresh.expires_in * 1000;
  }

  return session.accessToken;
}

// --- JWT minting / verification ---

export async function mintAccessToken(
  sessionId: string,
  clientId: string,
  scopes: string[],
  resource?: URL,
): Promise<string> {
  return new jose.SignJWT({
    sub: sessionId,
    client_id: clientId,
    scope: scopes.join(" "),
    ...(resource && { aud: resource.toString() }),
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setIssuer(config.serverUrl)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

export async function mintRefreshToken(
  sessionId: string,
  clientId: string,
  scopes: string[],
  resource?: URL,
): Promise<string> {
  return new jose.SignJWT({
    sub: sessionId,
    client_id: clientId,
    scope: scopes.join(" "),
    type: "refresh",
    ...(resource && { aud: resource.toString() }),
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setIssuer(config.serverUrl)
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(getSecret());
}

export interface VerifiedToken {
  sessionId: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: string;
}

export async function verifyToken(token: string): Promise<VerifiedToken> {
  const { payload } = await jose.jwtVerify(token, getSecret(), {
    issuer: config.serverUrl,
  });
  return {
    sessionId: payload.sub!,
    clientId: payload.client_id as string,
    scopes: ((payload.scope as string) || "").split(" ").filter(Boolean),
    expiresAt: payload.exp,
    resource: payload.aud as string | undefined,
  };
}
