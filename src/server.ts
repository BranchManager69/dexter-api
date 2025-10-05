import { app, env } from './app.js';
import { createLogger, style } from './logger.js';
import { startMemorySummarizer } from './workers/memorySummarizer.js';

const log = createLogger('server');
const stopSummarizer = startMemorySummarizer(env);
const server = app.listen(env.PORT, () => {
  log.success(`${style.status('ready', 'success')} ${style.kv('addr', `http://127.0.0.1:${env.PORT}`)}`);
});

function shutdown() {
  try {
    stopSummarizer();
  } catch {}
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
