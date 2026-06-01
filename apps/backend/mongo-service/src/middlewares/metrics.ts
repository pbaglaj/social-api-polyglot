import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

// Registry metric Prometheus + domyslne metryki procesu Node (CPU, pamiec, event loop).
const register = new client.Registry();
register.setDefaultLabels({ service: 'mongo-service' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
});
register.registerMetric(httpRequestsTotal);

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string) || req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}
