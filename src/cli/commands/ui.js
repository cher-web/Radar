import open from 'open';
import { startServer } from '../../ui/server.js';
import { heading, info, ok, err } from '../output.js';

const DEFAULT_PORT = 4510;

export async function ui(opts) {
  const port = opts?.port ? parseInt(opts.port, 10) : DEFAULT_PORT;
  const url = `http://localhost:${port}`;
  heading('radar ui');
  try {
    await startServer({ port });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      err(`port ${port} is already in use`);
      info(`try: radar ui --port ${port + 1}`);
      process.exit(1);
    }
    throw e;
  }
  ok(`server listening at ${url}`);
  info('Ctrl-C to stop');

  if (!opts?.noOpen) {
    try { await open(url); } catch { /* no-op */ }
  }
}
