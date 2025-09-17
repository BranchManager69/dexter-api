import type { Express, Request, Response } from 'express';

export function registerAuthConfigRoute(app: Express) {
  app.get('/auth/config', (_req: Request, res: Response) => {
    try {
      const supabaseUrl = process.env.SUPABASE_URL || null;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || null;
      res.json({ ok: true, supabaseUrl, supabaseAnonKey });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || 'auth_config_error' });
    }
  });
}
