import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/index.js';
import { pool } from '../db/index.js';

export async function registerSecurityPlugins(server: FastifyInstance): Promise<void> {
  // 1. CORS headers
  await server.register(cors, {
    origin: config.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // 2. Helmet security headers
  await server.register(helmet, {
    contentSecurityPolicy: false, // Allows Swagger UI to render inline assets
  });

  // 3. Rate limiting
  await server.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
  });

  // 4. Audit logging hook
  server.addHook('onRequest', async (request: FastifyRequest) => {
    // Skip static/health requests
    if (request.url === '/health' || request.url.startsWith('/documentation')) {
      return;
    }

    try {
      const ip = request.ip || 'unknown';
      const method = request.method;
      const url = request.url;
      const actor = (request.headers['x-actor-address'] as string) || 'anonymous';

      await pool.query(
        `INSERT INTO audit_logs (actor_address, action, target_type, target_id, details, ip_address, created_at)
         VALUES ($1, $2, 'http_request', $3, $4, $5, CURRENT_TIMESTAMP)`,
        [
          actor,
          `${method} ${url}`,
          url,
          JSON.stringify({ userAgent: request.headers['user-agent'] }),
          ip,
        ]
      );
    } catch {
      // In tests or if DB is offline, continue without breaking request
    }
  });
}

/**
 * Pre-handler guard verifying internal operator API key
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== config.INTERNAL_API_KEY) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or missing API key' });
  }
}
