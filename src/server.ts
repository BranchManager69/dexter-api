import { app, env } from './app.js';

const server = app.listen(env.PORT, () => {
  console.log(`[dexter-api] listening on http://127.0.0.1:${env.PORT}`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
