// Test-only lightweight MCP HTTP client used in vitest to prove concrete tool execution.
// Sends a POST to `${serverUrl}/callTool` with JSON body { name, arguments } and optional bearer.
export async function callMcpToolTestOnly(serverUrl: string, bearer: string | undefined, name: string, args: any) {
  const url = new URL('/callTool', serverUrl).toString();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name, arguments: args || {} }) });
  if (!r.ok) throw new Error(`callMcpToolTestOnly failed: ${r.status}`);
  return r.json();
}

