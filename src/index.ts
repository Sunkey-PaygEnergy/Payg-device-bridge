import { buildServer } from './server.js';

async function main() {
  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  const server = await buildServer();

  try {
    await server.listen({ port, host });
    server.log.info(`Sunkey PaygEnergy device bridge server listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
