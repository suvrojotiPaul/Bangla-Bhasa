export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, `${name} must be a positive whole number.`);
  return n;
}
