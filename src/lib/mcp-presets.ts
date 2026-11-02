// ---------------------------------------------------------------------------
// Built-in MCP server presets.
//
// Settings → MCP has always started from an empty list and a URL field. These
// are the servers worth trying first, with the URL and auth shape already
// filled in, so connecting one is a click instead of a research task.
//
// Two rules kept this list honest:
//   - Only endpoints that speak streamable HTTP are listed. The client in
//     src/lib/mcp.ts posts JSON-RPC and accepts a JSON or SSE *response*; it
//     does not do the older GET /sse transport, so a legacy `/sse` URL here
//     would only ever fail.
//   - Auth is stated, not assumed. "none" servers can be added in one click.
//     "bearer"/"header" servers open the form so the user pastes their own key.
//     "oauth" servers are listed for reference only, because connecting them
//     needs the provider's own consent flow, which this app does not run for
//     arbitrary servers.
// ---------------------------------------------------------------------------

/** How a preset authenticates against the app's three supported auth shapes. */
export type McpPresetAuth = "none" | "bearer" | "header" | "oauth";

export interface McpPreset {
  id: string;
  name: string;
  url: string;
  /** Short grouping used by the filter chips. */
  category: string;
  auth: McpPresetAuth;
  /** Header name when auth is "header". */
  headerName?: string;
  /** Tool-name prefix suggested for this server. */
  prefix: string;
  /** One line about what the server gives the assistant. */
  note: string;
  /** Where to read the provider's own setup page, when one is known. */
  docs?: string;
}

export const MCP_PRESETS: McpPreset[] = [
  // ---- open: add in one click -------------------------------------------
  {
    id: "deepwiki",
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    category: "Research",
    auth: "none",
    prefix: "deepwiki",
    note: "Wiki-style answers about any public GitHub repository. No key needed.",
    docs: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
  },
  {
    id: "context7",
    name: "Context7",
    url: "https://mcp.context7.com/mcp",
    category: "Docs",
    auth: "none",
    prefix: "context7",
    note: "Up-to-date library documentation, so answers match the version in use.",
    docs: "https://context7.com",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    url: "https://hf.co/mcp",
    category: "Research",
    auth: "none",
    prefix: "hf",
    note: "Search models, datasets and Spaces on the Hub.",
    docs: "https://huggingface.co/mcp",
  },
  {
    id: "aws-knowledge",
    name: "AWS Knowledge",
    url: "https://knowledge-mcp.global.api.aws",
    category: "Docs",
    auth: "none",
    prefix: "aws",
    note: "AWS documentation and architecture guidance straight from AWS.",
    docs: "https://aws.amazon.com",
  },
  {
    id: "wolfram",
    name: "Wolfram",
    url: "https://agenttools.wolfram.com/mcp",
    category: "Data",
    auth: "none",
    prefix: "wolfram",
    note: "Exact computation: units, chemistry, dates, symbolic math.",
    docs: "https://www.wolfram.com",
  },
  {
    id: "astro-docs",
    name: "Astro Docs",
    url: "https://mcp.docs.astro.build/mcp",
    category: "Docs",
    auth: "none",
    prefix: "astro",
    note: "Astro's own docs as a tool, current with the released version.",
    docs: "https://docs.astro.build",
  },
  {
    id: "javadocs",
    name: "Javadocs",
    url: "https://www.javadocs.dev/mcp",
    category: "Docs",
    auth: "none",
    prefix: "java",
    note: "Java and JVM library API reference lookups.",
    docs: "https://www.javadocs.dev",
  },
  {
    id: "openzeppelin-solidity",
    name: "OpenZeppelin (Solidity)",
    url: "https://mcp.openzeppelin.com/contracts/solidity/mcp",
    category: "Developer",
    auth: "none",
    prefix: "oz",
    note: "OpenZeppelin contract APIs, versions and security notes.",
    docs: "https://www.openzeppelin.com",
  },
  {
    id: "openmesh",
    name: "OpenMesh",
    url: "https://api.openmesh.dev/mcp",
    category: "Developer",
    auth: "none",
    prefix: "openmesh",
    note: "Service and protocol discovery across public APIs.",
    docs: "https://openmesh.dev",
  },

  // ---- keys: the form opens with the URL filled in ------------------------
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp",
    category: "Developer",
    auth: "bearer",
    prefix: "github",
    note: "Issues, pull requests and code search. Paste a fine-grained PAT as the token.",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "exa",
    name: "Exa Search",
    url: "https://mcp.exa.ai/mcp",
    category: "Research",
    auth: "header",
    headerName: "x-api-key",
    prefix: "exa",
    note: "Neural web search and page contents. Needs an Exa API key.",
    docs: "https://exa.ai",
  },
  {
    id: "apify",
    name: "Apify",
    url: "https://mcp.apify.com",
    category: "Data",
    auth: "bearer",
    prefix: "apify",
    note: "Run scrapers and actors for web data extraction. Needs an Apify token.",
    docs: "https://apify.com",
  },
  {
    id: "zapier",
    name: "Zapier",
    url: "https://mcp.zapier.com/api/mcp/mcp",
    category: "Productivity",
    auth: "bearer",
    prefix: "zapier",
    note: "Trigger your Zaps and app actions. Needs a Zapier MCP key.",
    docs: "https://zapier.com/mcp",
  },
  {
    id: "stripe",
    name: "Stripe",
    url: "https://mcp.stripe.com/",
    category: "Payments",
    auth: "bearer",
    prefix: "stripe",
    note: "Customers, invoices and payment links. Use a restricted key, not your live secret.",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    url: "https://app.hubspot.com/mcp/v1/http",
    category: "CRM",
    auth: "bearer",
    prefix: "hubspot",
    note: "Contacts, companies and deals from your portal. Needs a private-app token.",
    docs: "https://developers.hubspot.com",
  },
  {
    id: "parallel-search",
    name: "Parallel Search",
    url: "https://search-mcp.parallel.ai/mcp",
    category: "Research",
    auth: "bearer",
    prefix: "parallel",
    note: "Parallel's web search index. Uses your Parallel API key as a bearer token.",
    docs: "https://parallel.ai",
  },

  // ---- oauth: listed for reference, not addable here ---------------------
  {
    id: "figma",
    name: "Figma",
    url: "https://mcp.figma.com/mcp",
    category: "Design",
    auth: "oauth",
    prefix: "figma",
    note: "Reads design files and comments. Needs Figma's own sign-in flow.",
    docs: "https://help.figma.com",
  },
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    category: "Productivity",
    auth: "oauth",
    prefix: "slack",
    note: "Search channels and read threads. Needs Slack's own consent flow.",
    docs: "https://slack.com",
  },
  {
    id: "neon",
    name: "Neon",
    url: "https://mcp.neon.tech/mcp",
    category: "Data",
    auth: "oauth",
    prefix: "neon",
    note: "Manage Postgres projects and run queries. Needs Neon's OAuth flow.",
    docs: "https://neon.tech/docs",
  },
  {
    id: "supabase",
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    category: "Data",
    auth: "oauth",
    prefix: "supabase",
    note: "Projects, tables and edge functions. Needs Supabase's OAuth flow.",
    docs: "https://supabase.com/docs",
  },
  {
    id: "vercel",
    name: "Vercel",
    url: "https://mcp.vercel.com/",
    category: "Developer",
    auth: "oauth",
    prefix: "vercel",
    note: "Deployments, logs and projects. Needs Vercel's OAuth flow.",
    docs: "https://vercel.com/docs",
  },
];

/** Filter chips derived from the catalogue, in a stable order. */
export const MCP_PRESET_CATEGORIES: string[] = [
  ...new Set(MCP_PRESETS.map((p) => p.category)),
];

export function presetAuthLabel(auth: McpPresetAuth): string {
  if (auth === "none") return "open";
  if (auth === "bearer") return "token";
  if (auth === "header") return "api key";
  return "oauth";
}
