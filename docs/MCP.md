# Connect an AI assistant (MCP)

BSU Scheduler includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so assistants that support MCP can work with your workspace: look at channels, draft and schedule posts, and read analytics.

```
POST {APP_URL}/api/mcp
Authorization: Bearer bsu_live_…
```

It uses the same API keys as the [REST API](API.md). Create one in **Settings → API & webhooks**. The key decides what the assistant may do:

| Tool | Needs scope |
|---|---|
| `get_workspace` | any |
| `list_channels` | `channels:read` |
| `list_posts`, `get_post` | `posts:read` |
| `create_post`, `update_post`, `delete_post` | `posts:write` |
| `get_analytics` | `analytics:read` |

A tool the key can't use isn't offered at all. The assistant acts with the role of the person who made the key, so the app's usual rules apply (caption limits, contributors can only save drafts). Give a key only the scopes it needs, and revoke it when you stop using it. Posting with `mode: "now"` publishes immediately; the tool descriptions tell the assistant to use it only when asked.

## Connecting

**Claude Code**

```
claude mcp add --transport http bsu-scheduler https://your-domain/api/mcp --header "Authorization: Bearer bsu_live_…"
```

**Claude Desktop and other clients that only start local programs** can use the `mcp-remote` bridge:

```json
{ "mcpServers": { "bsu-scheduler": { "command": "npx", "args": ["mcp-remote", "https://your-domain/api/mcp", "--header", "Authorization: Bearer ${BSU_KEY}"], "env": { "BSU_KEY": "bsu_live_…" } } } }
```

**ChatGPT and other tools:** any client that can send a custom `Authorization` header to an HTTPS MCP address can use it. Some clients, including ChatGPT's connector screen, only offer "no authentication" or OAuth sign-in, and this server doesn't have OAuth yet, so they can't connect directly.

The address must be reachable by the assistant. A server running on `localhost` works with local tools like Claude Code; hosted assistants need a public HTTPS address.

## Details

- Transport: Streamable HTTP, JSON responses. `GET` and `DELETE` return `405` because the server never opens its own stream.
- Protocol versions: 2025-06-18, 2025-03-26, 2024-11-05.
- Rate limit: shared with the REST API (120 requests a minute per key).
