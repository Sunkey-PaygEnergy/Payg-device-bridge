import Fastify, { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { registerSecurityPlugins } from './security/plugins.js';
import { deviceRoutes } from './api/routes/devices.js';
import { fleetRoutes } from './api/routes/fleet.js';
import { riskRoutes } from './api/routes/risk.js';
import { reportRoutes } from './api/routes/reports.js';
import { financierRoutes } from './api/routes/financier.js';
import { paymentRoutes } from './api/routes/payments.js';

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

  // 1. Security Plugins (CORS, Helmet, Rate-Limit, Audit Log)
  await registerSecurityPlugins(fastify);

  // 2. OpenAPI / Swagger Documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Sunkey PaygEnergy - Device Bridge API',
        description:
          'OpenPAYGO hardware token generation, Soroban lease sync, IoT telemetry, and multi-currency mobile money bridge',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:3001',
          description: 'Local development server',
        },
      ],
      tags: [
        { name: 'Devices', description: 'Hardware registration and lease binding' },
        { name: 'Fleet', description: 'Fleet-wide health and IoT telemetry metrics' },
        { name: 'Risk', description: 'Overdue leases and default risk evaluation' },
        { name: 'Reports', description: 'Repayment curves and CSV audit exports' },
        { name: 'Financier', description: 'Pool portfolios and compliance logs' },
        { name: 'Payments', description: 'Mobile money and Stellar anchor webhooks' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // 3. Health check route
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'payg-device-bridge',
      version: '1.0.0',
    };
  });

  // 4. Register API v1 Route Plugins
  await fastify.register(deviceRoutes, { prefix: '/api/v1/devices' });
  await fastify.register(fleetRoutes, { prefix: '/api/v1/fleet' });
  await fastify.register(riskRoutes, { prefix: '/api/v1/risk' });
  await fastify.register(reportRoutes, { prefix: '/api/v1/reports' });
  await fastify.register(financierRoutes, { prefix: '/api/v1/financier' });
  await fastify.register(paymentRoutes, { prefix: '/api/v1/payments' });

  return fastify;
}
