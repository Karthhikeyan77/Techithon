import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../src/lib/firebase-admin.ts';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : EPHEMERAL_FALLBACK_SECRET;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, hashHex] = storedHash.split(':');
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface TeamTokenPayload {
  teamId: string;
  roomId: string;
  roomCode: string;
  teamName: string;
  iat: number;
}

export function signTeamToken(payload: Omit<TeamTokenPayload, 'iat'>): string {
  const full: TeamTokenPayload = { ...payload, iat: Date.now() };
  const data = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyTeamToken(token: string): TeamTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TeamTokenPayload;
    if (!parsed.teamId || !parsed.roomId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface HostUser {
  uid: string;
  email: string;
  name?: string;
}

export type HostTokenVerifier = (token: string) => Promise<HostUser>;

let customHostVerifier: HostTokenVerifier | null = null;

export function setTestHostTokenVerifier(verifier: HostTokenVerifier | null) {
  customHostVerifier = verifier;
}

export async function verifyHostTokenString(token: string): Promise<HostUser> {
  if (customHostVerifier) {
    return customHostVerifier(token);
  }
  const decoded = await verifyFirebaseToken(token);
  if (!decoded.uid || !decoded.email) {
    throw new Error('Invalid Firebase token payload');
  }
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name,
  };
}

export interface AuthenticatedHostRequest extends Request {
  hostUser?: HostUser;
}

export interface AuthenticatedTeamRequest extends Request {
  teamSession?: TeamTokenPayload;
}

export async function requireHostAuth(
  req: AuthenticatedHostRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Host authentication required' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.hostUser = await verifyHostTokenString(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired host session' });
  }
}

export function requireTeamAuth(
  req: AuthenticatedTeamRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Team session required' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const session = verifyTeamToken(token);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired team session' });
    return;
  }
  req.teamSession = session;
  next();
}

// Lightweight sliding window rate limiter
export function createRateLimiter(options: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const timestamps = (hits.get(key) || []).filter((t) => now - t < options.windowMs);
    if (timestamps.length >= options.maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
      return;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    // Periodic cleanup when map grows
    if (hits.size > 2000) {
      for (const [k, list] of hits.entries()) {
        if (list.every((t) => now - t >= options.windowMs)) {
          hits.delete(k);
        }
      }
    }
    next();
  };
}
