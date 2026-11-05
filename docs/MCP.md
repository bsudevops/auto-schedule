# Connect an AI assistant (MCP)

BSU Scheduler includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so assistants that support MCP can work with your workspace: look at channels, draft and schedule posts, and read analytics.

```
POST {APP_URL}/api/mcp
```

Assistants connect in one of two ways:

- **Sign in with OAuth** (Claude, ChatGPT and other hosted assistants). Add the address as a connector; the assistant opens a BSU Scheduler page where you sign in, pick a workspace and choose what it may do. Nothing to copy.
- **API key** (tools that can send a header). Create one in **Settings → API & webhooks** and send `Authorization: Bearer bsu_live_…`. These are the same keys as the [REST API](API.md).

Either way, the permissions decide what the assistant may do:

| Tool | Needs scope |
|---|---|
| `get_workspace` | any |
| `list_channels` | `channels:read` |
| `list_posts`, `get_post` | `posts:read` |
| `create_post`, `update_post`, `delete_post` | `posts:write` |
| `get_analytics` | `analytics:read` |

A tool the key can't use isn't offered at all. The assistant acts with the role of the person who made the key, so the app's usual rules apply (caption limits, contributors can only save drafts). Give a key only the scopes it needs, and revoke it when you stop using it. Posting with `mode: "now"` publishes immediately; the tool descriptions tell the assistant to use it only when asked.

## Connecting

**Claude (claude.ai, Claude Desktop, mobile)**

1. Go to **Settings → Connectors → Add custom connector**.
2. Name it "BSU Scheduler" and paste `{APP_URL}/api/mcp`. Leave the advanced OAuth fields empty.
3. Click **Connect**. Sign in to BSU Scheduler and choose what it may use: **All workspaces you own or manage** (the default, which also covers clients you add later) or a single workspace. Pick the permissions and click **Allow**.
4. In a chat, turn the connector on from the tools menu and ask, for example, "List my channels" or "Draft a LinkedIn post for tomorrow at 10am".

With all workspaces, the assistant gets two extra tools: `list_workspaces`, and `create_workspace` (with the "Add new client workspaces" permission, for organization owners and admins). Every other tool takes a `workspace` argument, the client's name or ID, so you can say "schedule this for Wexley" or "show next week's posts for each client". It acts with your role in each workspace.

Only owners and managers of a workspace can connect an app to it, the same people who can create API keys. Connected apps are listed under **Settings → API & webhooks → Connected AI apps** (an all-workspace connection shows in every workspace its person belongs to), where anyone with that role can disconnect them; access stops at once.

**ChatGPT:** add a connector (developer mode) with the same address and choose OAuth. It signs in the same way.

**Claude Code**

```
claude mcp add --transport http bsu-scheduler https://your-domain/api/mcp --header "Authorization: Bearer bsu_live_…"
```

**Claude Desktop and other clients that only start local programs** can use the `mcp-remote` bridge:

```json
{ "mcpServers": { "bsu-scheduler": { "command": "npx", "args": ["mcp-remote", "https://your-domain/api/mcp", "--header", "Authorization: Bearer ${BSU_KEY}"], "env": { "BSU_KEY": "bsu_live_…" } } } }
```

**Other tools:** any client that can send a custom `Authorization` header, or that supports MCP's OAuth sign-in, can connect.

The address must be reachable by the assistant. A server running on `localhost` works with local tools like Claude Code; hosted assistants need a public HTTPS address.

## Details

- OAuth 2.1 with PKCE (S256 only) and dynamic client registration (RFC 7591). Discovery: `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414). Endpoints: `/oauth/register`, `/oauth/authorize`, `/oauth/token`. An unauthenticated MCP request gets `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- Access tokens last one hour and are stored hashed, like API keys. Refresh tokens last 90 days and rotate on every use; a used one stops working. Sign-in codes last 10 minutes and work once. Redirect addresses must be HTTPS, or http on localhost.

- Transport: Streamable HTTP, JSON responses. `GET` and `DELETE` return `405` because the server never opens its own stream.
- Protocol versions: 2025-06-18, 2025-03-26, 2024-11-05.
- Rate limit: shared with the REST API (120 requests a minute per key).
