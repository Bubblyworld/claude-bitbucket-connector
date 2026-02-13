# Bitbucket MCP Connector for Claude Web

An MCP server (Streamable HTTP transport) that connects Claude web to the Bitbucket Cloud REST API via OAuth. Each user authenticates with their own Bitbucket account.

## Setup

### 1. Create a Bitbucket OAuth Consumer

Go to your Bitbucket workspace settings > OAuth consumers > Add consumer:
- **Callback URL**: `https://your-server.com/oauth/bb/callback`
- **Permissions**: Repository (read/write), Pull requests (read/write), Account (read)

Note the **Key** and **Secret**.

### 2. Configure

```sh
cp .env.example .env
```

Fill in:
- `SERVER_URL` — your server's public HTTPS URL (e.g. `https://bb-mcp.example.com`)
- `BITBUCKET_KEY` / `BITBUCKET_SECRET` — from step 1
- `JWT_SECRET` — a random string for signing tokens

### 3. Build and Run

```sh
npm install
npm run build
npm start
```

### 4. Connect from Claude

Go to Claude web > Settings > Connectors > Add custom connector, and enter `https://your-server.com/mcp`. You'll be redirected to Bitbucket to authorize access.

**Important**: Claude web only connects to MCP servers on port 443 (standard HTTPS). If your server listens on a different port, put it behind a reverse proxy that terminates TLS on 443.

## Tools

All tools proxy to the [Bitbucket Cloud REST API v2](https://developer.atlassian.com/cloud/bitbucket/rest/intro/):

| Tool | Description |
|------|-------------|
| `bb_get` | `GET /2.0/{path}` |
| `bb_post` | `POST /2.0/{path}` with JSON body |
| `bb_put` | `PUT /2.0/{path}` with JSON body |
| `bb_patch` | `PATCH /2.0/{path}` with JSON body |
| `bb_delete` | `DELETE /2.0/{path}` |

Example: ask Claude to "list my Bitbucket workspaces" and it will call `bb_get` with path `/workspaces`.
