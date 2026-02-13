import { config } from "../config.js";

const AUTHORIZE_URL = "https://bitbucket.org/site/oauth2/authorize";
const TOKEN_URL = "https://bitbucket.org/site/oauth2/access_token";

export interface BitbucketTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function buildAuthorizationUrl(
  redirectUri: string,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.bitbucketKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(
  body: URLSearchParams,
): Promise<BitbucketTokens> {
  const credentials = Buffer.from(
    `${config.bitbucketKey}:${config.bitbucketSecret}`,
  ).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bitbucket token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<BitbucketTokens>;
}

export function exchangeCode(code: string): Promise<BitbucketTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.serverUrl}/oauth/bb/callback`,
    }),
  );
}

export function refreshToken(token: string): Promise<BitbucketTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
    }),
  );
}
