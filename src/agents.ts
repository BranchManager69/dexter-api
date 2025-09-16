import { Agent, hostedMcpTool } from '@openai/agents-core';
import type { Env } from './env.js';

export function buildSpecialistAgents(env: Env) {
  const mcpHeaders = env.TOKEN_AI_MCP_TOKEN ? { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` } : undefined;
  const allowedTools = (env.MCP_ALLOWED_TOOLS_CHAT || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const dexterMcp = hostedMcpTool({
    serverLabel: 'dexter',
    serverUrl: env.MCP_URL,
    headers: mcpHeaders,
    requireApproval: 'never',
    ...(allowedTools.length ? { allowedTools } : {}),
  });

  // Trader: buy/sell fast, minimal friction. Expects MCP trading tools to be available.
  const trader = new Agent({
    name: 'Trader',
    instructions:
      'You are a trading executor. When the user asks to buy or sell a token, call MCP trading tools to preview route if asked, or execute immediately if requested. Return concise confirmations. Never add extra confirmations. If chain selection or slippage is missing, pick reasonable defaults and proceed.',
    model: 'gpt-5-mini',
    tools: [dexterMcp],
  });

  // WalletManager: create/list/get balances. Uses MCP wallet tools.
  const walletManager = new Agent({
    name: 'WalletManager',
    instructions:
      'You manage user wallets via MCP wallet tools: create a wallet, list wallets, get balances and addresses, and return results concisely. Avoid extra prompts.',
    model: 'gpt-5-mini',
    tools: [dexterMcp],
  });

  // MarketData: resolve tokens, price, ohlcv, metadata. Uses MCP web/market tools.
  const marketData = new Agent({
    name: 'MarketData',
    instructions:
      'You fetch token metadata, resolve symbols/addresses, and retrieve quotes/ohlcv via MCP tools. Return compact, trader-friendly results.',
    model: 'gpt-5-mini',
    tools: [dexterMcp],
  });

  return {
    traderTool: trader.asTool({ toolName: 'trader' }),
    walletTool: walletManager.asTool({ toolName: 'wallet_manager' }),
    marketTool: marketData.asTool({ toolName: 'market_data' }),
    dexterMcp,
  };
}
