export class ApiError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** 401 { login: true }: nobody is signed in on this browser. */
  get needsLogin() {
    return this.status === 401 && this.body?.login === true;
  }

  /** The server answers 503 { setup: true } until the course is built. */
  get needsSetup() {
    return this.status === 503 && this.body?.setup === true;
  }

  get offline() {
    return this.status === 0;
  }
}

async function request(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Can't reach the Bhasha server. Is it still running?");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (HTTP ${res.status}).`, data);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
};
