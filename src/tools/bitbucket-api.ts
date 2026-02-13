import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBitbucketToken } from "../auth/tokens.js";

const BB_API_BASE = "https://api.bitbucket.org/2.0";

function sessionIdFromExtra(extra: unknown): string {
  const e = extra as { authInfo?: { extra?: { sessionId?: string } } };
  const sessionId = e?.authInfo?.extra?.sessionId;
  if (typeof sessionId !== "string") {
    throw new Error("Missing session — are you authenticated?");
  }
  return sessionId;
}

function buildUrl(path: string, queryParams?: Record<string, string>): string {
  const url = new URL(BB_API_BASE + path);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function bbFetch(
  sessionId: string,
  method: string,
  path: string,
  queryParams?: Record<string, string>,
  body?: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const token = await getBitbucketToken(sessionId);
  const url = buildUrl(path, queryParams);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();

  if (!res.ok) {
    return {
      content: [
        {
          type: "text",
          text: `Bitbucket API error (${res.status}): ${text}`,
        },
      ],
    };
  }

  return { content: [{ type: "text", text }] };
}

const pathParam = z.string().describe("Bitbucket API path, e.g. /repositories/myworkspace/myrepo");
const queryParam = z.record(z.string()).optional().describe("Query parameters");
const bodyParam = z.record(z.unknown()).describe("JSON request body");

export function registerTools(server: McpServer): void {
  server.tool(
    "bb_get",
    "Make a GET request to the Bitbucket Cloud REST API",
    { path: pathParam, queryParams: queryParam },
    async ({ path, queryParams }, extra) =>
      bbFetch(sessionIdFromExtra(extra), "GET", path, queryParams),
  );

  server.tool(
    "bb_post",
    "Make a POST request to the Bitbucket Cloud REST API",
    { path: pathParam, queryParams: queryParam, body: bodyParam },
    async ({ path, queryParams, body }, extra) =>
      bbFetch(sessionIdFromExtra(extra), "POST", path, queryParams, body),
  );

  server.tool(
    "bb_put",
    "Make a PUT request to the Bitbucket Cloud REST API",
    { path: pathParam, queryParams: queryParam, body: bodyParam },
    async ({ path, queryParams, body }, extra) =>
      bbFetch(sessionIdFromExtra(extra), "PUT", path, queryParams, body),
  );

  server.tool(
    "bb_patch",
    "Make a PATCH request to the Bitbucket Cloud REST API",
    { path: pathParam, queryParams: queryParam, body: bodyParam },
    async ({ path, queryParams, body }, extra) =>
      bbFetch(sessionIdFromExtra(extra), "PATCH", path, queryParams, body),
  );

  server.tool(
    "bb_delete",
    "Make a DELETE request to the Bitbucket Cloud REST API",
    { path: pathParam, queryParams: queryParam },
    async ({ path, queryParams }, extra) =>
      bbFetch(sessionIdFromExtra(extra), "DELETE", path, queryParams),
  );
}
