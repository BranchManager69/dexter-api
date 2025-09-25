import { app, env } from './app.js';
import { createLogger, style } from './logger.js';

const log = createLogger('server');
const server = app.listen(env.PORT, () => {
  log.success(`${style.status('ready', 'success')} ${style.kv('addr', `http://127.0.0.1:${env.PORT}`)}`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
