export function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const code = err?.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  if (status >= 500) {
    console.error(`[server] ${req.method} ${req.path} failed:`, err);
  }
  res.status(status).json({
    error: {
      code,
      message: status >= 500 ? 'Something went wrong on the server.' : err.message,
    },
  });
}

export function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route: ${req.method} ${req.path}` } });
}
