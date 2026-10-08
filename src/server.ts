import Fastify, { FastifyInstance } from 'fastify';

export interface ServerOptions {
  port?: number;
  host?: string;
  logger?: boolean | object;
}

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // Basic health check route
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'payg-device-bridge',
      version: '1.0.0',
    };
  });

  return fastify;
}
