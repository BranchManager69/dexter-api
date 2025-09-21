import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import prisma from '../prisma.js';

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:';
  } catch { return false; }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function genClientId(): string {
  return 'dcr_' + crypto.randomBytes(16).toString('hex');
}

export function registerMcpDcrRoutes(app: Express) {
  // RFC 7591 public client registration (reduced, sufficient for MCP connectors)
  app.post('/api/mcp/dcr/register', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, any>;
      const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map((s: any) => String(s)).filter(Boolean) : [];
      if (redirect_uris.length === 0 || !redirect_uris.every(isHttpsUrl)) {
        return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris must be non-empty and HTTPS' });
      }
      const grant_types = unique((Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code']).map((s: any) => String(s)));
      const response_types = unique((Array.isArray(body.response_types) ? body.response_types : ['code']).map((s: any) => String(s)));
      const token_endpoint_auth_method = String(body.token_endpoint_auth_method || 'none');
      const application_type = body.application_type ? String(body.application_type) : 'web';
      const pkce_required = body.pkce_required === undefined ? true : Boolean(body.pkce_required);
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

      const client_id = genClientId();
      const created = await prisma.mcp_oauth_clients.create({
        data: {
          client_id,
          redirect_uris,
          grant_types,
          response_types,
          token_endpoint_auth_method,
          application_type,
          pkce_required,
          metadata,
        },
      });

      const issuedAt = Math.floor(new Date(created.created_at).getTime() / 1000);
      return res.status(201).json({
        client_id: created.client_id,
        client_id_issued_at: issuedAt,
        redirect_uris: created.redirect_uris,
        grant_types: created.grant_types,
        response_types: created.response_types,
        token_endpoint_auth_method: created.token_endpoint_auth_method,
        application_type: created.application_type,
        pkce_required: created.pkce_required,
        metadata: created.metadata,
      });
    } catch (error: any) {
      return res.status(500).json({ error: 'server_error', error_description: error?.message || String(error) });
    }
  });
}

