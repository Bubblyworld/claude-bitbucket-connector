import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InMemoryClientsStore } from "./clients.js";
import { buildAuthorizationUrl } from "./bitbucket.js";
import {
  storePendingAuth,
  getPendingCodeChallenge,
  consumeAuthorizationCode,
  createSession,
  deleteSession,
  mintAccessToken,
  mintRefreshToken,
  verifyToken,
} from "./tokens.js";
import { config } from "../config.js";

export class BitbucketOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();

  get skipLocalPkceValidation(): boolean {
    return false;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const nonce = crypto.randomUUID();
    storePendingAuth(nonce, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
    });

    const bbCallbackUrl = `${config.serverUrl}/oauth/bb/callback`;
    const bbAuthorizeUrl = buildAuthorizationUrl(bbCallbackUrl, nonce);
    res.redirect(bbAuthorizeUrl);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const challenge = getPendingCodeChallenge(authorizationCode);
    if (!challenge) {
      throw new Error("Unknown or expired authorization code");
    }
    return challenge;
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const pending = consumeAuthorizationCode(authorizationCode);
    if (!pending) {
      throw new Error("Unknown or expired authorization code");
    }

    const sessionId = createSession(pending.bitbucketTokens);
    const scopes = ["bitbucket"];
    const accessToken = await mintAccessToken(
      sessionId, pending.clientId, scopes, resource,
    );
    const refreshToken = await mintRefreshToken(
      sessionId, pending.clientId, scopes, resource,
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const verified = await verifyToken(refreshToken);
    const effectiveScopes = scopes ?? verified.scopes;
    const accessToken = await mintAccessToken(
      verified.sessionId, verified.clientId, effectiveScopes, resource,
    );
    const newRefreshToken = await mintRefreshToken(
      verified.sessionId, verified.clientId, effectiveScopes, resource,
    );

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = await verifyToken(token);
    return {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt,
      ...(verified.resource && { resource: new URL(verified.resource) }),
      extra: { sessionId: verified.sessionId },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    try {
      const verified = await verifyToken(request.token);
      deleteSession(verified.sessionId);
    } catch {
      // Token already invalid or expired — nothing to revoke.
    }
  }
}
