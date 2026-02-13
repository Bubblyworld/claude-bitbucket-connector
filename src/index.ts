import express from "express";
import cors from "cors";
import morgan from "morgan";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { BitbucketOAuthProvider } from "./auth/provider.js";
import { exchangeCode } from "./auth/bitbucket.js";
import {
  consumePendingAuth,
  storeAuthorizationCode,
} from "./auth/tokens.js";
import { registerTools } from "./tools/bitbucket-api.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

const provider = new BitbucketOAuthProvider();
const issuerUrl = new URL(config.serverUrl);

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: issuerUrl,
  }),
);

// Bitbucket OAuth callback — receives BB auth code, creates our own auth code,
// and redirects back to Claude's callback URL.
app.get("/oauth/bb/callback", async (req, res) => {
  try {
    const bbCode = req.query.code as string | undefined;
    const nonce = req.query.state as string | undefined;

    if (!bbCode || !nonce) {
      res.status(400).send("Missing code or state from Bitbucket");
      return;
    }

    const pending = consumePendingAuth(nonce);
    if (!pending) {
      res.status(400).send("Unknown or expired authorization state");
      return;
    }

    const bbTokens = await exchangeCode(bbCode);
    const ourCode = randomUUID();
    storeAuthorizationCode(ourCode, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      bitbucketTokens: bbTokens,
    });

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set("code", ourCode);
    if (pending.state) {
      redirectUrl.searchParams.set("state", pending.state);
    }
    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("Bitbucket callback error:", err);
    res.status(500).send("Internal error during Bitbucket OAuth callback");
  }
});

// MCP endpoint with bearer auth
const authMiddleware = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: `${config.serverUrl}/.well-known/oauth-protected-resource`,
});

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: "Bad request: expected initialize or valid session" });
    return;
  }

  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
    }
  };

  const server = new McpServer({
    name: "bitbucket-connector",
    version: "1.0.0",
  });
  registerTools(server);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

app.delete("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Bitbucket MCP connector listening on port ${config.port}`);
  console.log(`Server URL: ${config.serverUrl}`);
});
