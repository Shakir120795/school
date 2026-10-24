// Small helpers shared by routes.
export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === "");
  return missing.length ? missing : null;
}

export function errorHandler(err, req, res, _next) {
  if (err?.code === "P2002") return res.status(409).json({ error: "UNIQUE_CONSTRAINT", target: err.meta?.target });
  if (err?.code === "P2003") return res.status(409).json({ error: "FOREIGN_KEY_CONSTRAINT" });
  if (err?.code === "P2025") return res.status(404).json({ error: "NOT_FOUND" });
  console.error(err);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}
