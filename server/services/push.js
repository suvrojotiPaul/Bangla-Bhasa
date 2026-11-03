import crypto from 'node:crypto';
import { getMeta, setMeta } from '../db/db.js';

// Web push (RFC 8030) signed with VAPID (RFC 8292). The message travels encrypted in the push
// (RFC 8291, aes128gcm) so the phone can show it straight away, which iPhones need; a device saved
// without its keys gets an empty push and public/sw.js asks the server what to show. Everything is
// done with node:crypto, so no extra package is needed.

const JWT_HOURS = 12;
// A reminder that can't be delivered within this time (phone off) is dropped, not sent late.
const TTL_SECONDS = 4 * 60 * 60;
const SEND_TIMEOUT_MS = 10_000;
// The push services allow any contact here; this one tells them nothing about the owner.
const SUBJECT = 'mailto:bhasha@example.com';
// The server POSTs to whatever endpoint a browser hands it, so only real push services are allowed.
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const base64url = (data) => Buffer.from(data).toString('base64url');

let keys = null;

/** The server's VAPID key pair: made on first use and kept in the meta table. */
function vapidKeys() {
  if (keys) return keys;
  let jwk = getMeta('vapid_private_jwk');
  if (!jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    jwk = JSON.stringify(privateKey.export({ format: 'jwk' }));
    setMeta('vapid_private_jwk', jwk);
  }
  const parsed = JSON.parse(jwk);
  // Browsers take the public key as an uncompressed P-256 point: 0x04 || x || y.
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(parsed.x, 'base64url'), Buffer.from(parsed.y, 'base64url')]);
  keys = { privateKey: crypto.createPrivateKey({ key: parsed, format: 'jwk' }), publicKey: base64url(point) };
  return keys;
}

export const vapidPublicKey = () => vapidKeys().publicKey;

export function isPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** The signed token that proves to the push service that this server sent the push. */
export function vapidToken(audience, now = Date.now()) {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = base64url(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + JWT_HOURS * 3600, sub: SUBJECT }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidKeys().privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${base64url(signature)}`;
}

const hkdf = (salt, ikm, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

/**
 * Encrypts a push message for one device (RFC 8291 with RFC 8188 aes128gcm, a single record).
 * `p256dh` and `auth` come from the browser's subscription. `fixed` is only for tests.
 */
export function encryptPayload(plaintext, { p256dh, auth }, fixed = {}) {
  const deviceKey = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.privateKey) ecdh.setPrivateKey(fixed.privateKey);
  else ecdh.generateKeys();
  const serverKey = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(deviceKey);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), deviceKey, serverKey]), 32);
  const salt = fixed.salt ?? crypto.randomBytes(16);
  const key = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', key, nonce);
  // 0x02 marks the last (here the only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverKey.length, 20);
  return Buffer.concat([header, serverKey, body]);
}

/**
 * Sends one device a push: { endpoint, p256dh, auth } and the message to show ({ title, body, url }).
 * 'sent', 'gone' (the subscription has expired: forget it) or 'failed'.
 */
export async function sendPush(device, message = null) {
  const { endpoint } = device;
  if (!isPushEndpoint(endpoint)) return 'gone';
  const encrypted = message && device.p256dh && device.auth;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        TTL: String(TTL_SECONDS),
        Urgency: 'normal',
        Authorization: `vapid t=${vapidToken(new URL(endpoint).origin)}, k=${vapidPublicKey()}`,
        ...(encrypted ? { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' } : {}),
      },
      body: encrypted ? encryptPayload(JSON.stringify(message), device) : '',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (res.ok) return 'sent';
    const reason = (await res.text()).slice(0, 200);
    // Apple's way of saying the device no longer exists.
    if (res.status === 400 && reason.includes('BadWebPushToken')) return 'gone';
    console.warn(`[push] ${new URL(endpoint).hostname} answered ${res.status}: ${reason}`);
    return 'failed';
  } catch (err) {
    console.warn(`[push] ${new URL(endpoint).hostname}: ${err.message}`);
    return 'failed';
  }
}
