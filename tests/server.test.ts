import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';

describe('Fastify Bridge Server HTTP Endpoints', { timeout: 30000 }, () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  it('GET /health returns 200 OK and service metadata', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('payg-device-bridge');
  });

  it('GET /documentation returns Swagger documentation', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/documentation/json',
    });

    expect(response.statusCode).toBe(200);
    const doc = JSON.parse(response.body);
    expect(doc.info.title).toContain('Sunkey PaygEnergy');
  });
});
