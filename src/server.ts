import { MCPServer, text, forwardAuthHeaders } from "mcpfy-sdk/server";
import type { ToolContext } from "mcpfy-sdk/server";
import { z } from "zod";

const server = new MCPServer({
  name: "test",
  version: "1.0.0",
  description: "A simple sample API to manage system users.",
});

function outboundAuthHeaders(ctx?: Pick<ToolContext, "requestHeaders" | "auth">): Record<string, string> {
  // Prefer credentials from the inbound MCP HTTP request (same as hosted MCP-backend).
  const fromRequest = forwardAuthHeaders(ctx);
  if (Object.keys(fromRequest).length > 0) return fromRequest;
  return {};
}

function applyPathParams(
  url: string,
  pathParams: Record<string, { placeholder?: string }> | undefined,
  args: Record<string, unknown>
): string {
  if (!pathParams) return url;
  let out = url;
  for (const [name, spec] of Object.entries(pathParams)) {
    const placeholder = spec.placeholder || `{{${name}}}`;
    const value = args[name];
    if (value !== undefined && value !== null) {
      out = out.split(placeholder).join(String(value));
    }
  }
  return out;
}

function applyQueryParams(
  url: string,
  queryParams: Record<string, unknown> | undefined,
  args: Record<string, unknown>
): string {
  if (!queryParams || Object.keys(queryParams).length === 0) return url;
  const qs = new URLSearchParams();
  for (const name of Object.keys(queryParams)) {
    const value = args[name];
    if (value !== undefined && value !== null) qs.append(name, String(value));
  }
  const s = qs.toString();
  if (!s) return url;
  return url + (url.includes("?") ? "&" : "?") + s;
}

function buildBody(
  bodyInput: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
  method: string
): string | undefined {
  if (!bodyInput || Object.keys(bodyInput).length === 0) return undefined;
  if (!["post", "put", "patch"].includes(method.toLowerCase())) return undefined;
  const body: Record<string, unknown> = {};
  for (const name of Object.keys(bodyInput)) {
    if (args[name] !== undefined) body[name] = args[name];
  }
  return JSON.stringify(body);
}

async function callUpstream(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  pathParams?: Record<string, { placeholder?: string }>;
  queryParams?: Record<string, unknown>;
  bodyInput?: Record<string, unknown>;
  args: Record<string, unknown>;
  ctx?: Pick<ToolContext, "requestHeaders" | "auth">;
}): Promise<{ status: number; statusText: string; data: unknown }> {
  const method = opts.method.toUpperCase();
  let url = applyPathParams(opts.url, opts.pathParams, opts.args);
  url = applyQueryParams(url, opts.queryParams, opts.args);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...outboundAuthHeaders(opts.ctx),
    ...(opts.headers || {}),
  };
  const body = buildBody(opts.bodyInput, opts.args, method);
  const res = await fetch(url, { method, headers, body });
  const textBody = await res.text();
  let data: unknown = textBody;
  try {
    data = textBody ? JSON.parse(textBody) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return { status: res.status, statusText: res.statusText, data };
}



server.tool(
  {
    name: "getUsers",
    description: "Retrieve a list of users",
    schema: z.object({}),
  },
  async (args, ctx) => {
    const result = await callUpstream({
      method: "get",
      url: "https://example.com/users",
      headers: {},
      pathParams: {},
      queryParams: {},
      bodyInput: {},
      args: args as Record<string, unknown>,
      ctx,
    });
    const payload = result.data;
    return text(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  }
);


const transport = process.argv.includes("--http")
  ? "http"
  : process.argv.includes("--stdio")
    ? "stdio"
    : "http";

await server.listen(transport === "http" ? { transport: "http" } : { transport: "stdio" });
