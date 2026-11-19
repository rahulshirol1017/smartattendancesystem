import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  LivenessChallengeType,
  VerificationResult,
  VerificationSessionDescriptor,
} from '../src/shared/types.ts';
import { getSecurityConfig } from './config.ts';

/**
 * Persistent, Atomic, Cryptographically Bound Session Manager
 *
 * - Zero hardcoded secrets (via server/config.ts).
 * - Requires trusted parent VTU application authentication (Bearer key or signed parent assertion)
 *   before issuing any verification session.
 * - Derives studentId and qrSessionId from authenticated parent credentials—never from raw browser input.
 * - Assigns a server-randomized liveness challenge per session.
 * - Persists sessions in SQLite (node:sqlite) with atomic single-statement consumption
 *   so restarts or concurrent race conditions can never reuse a session.
 */

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const CHALLENGES: Array<{ type: LivenessChallengeType; instruction: string }> = [
  { type: 'BLINK_AND_HEAD_LEFT', instruction: 'Blink once, then slowly turn head left.' },
  { type: 'BLINK_AND_HEAD_RIGHT', instruction: 'Blink once, then slowly turn head right.' },
  { type: 'BLINK_AND_NOD', instruction: 'Blink once, then gently nod your head.' },
];

let dbInstance: InstanceType<typeof DatabaseSync> | null = null;

function getDb(): InstanceType<typeof DatabaseSync> {
  if (dbInstance) return dbInstance;
  const dbPath = path.resolve(process.cwd(), getSecurityConfig().verificationDbPath);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS verification_sessions (
      verification_session_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      qr_session_id TEXT NOT NULL,
      challenge_type TEXT NOT NULL,
      challenge_nonce TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      consumed_at_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS consumed_parent_assertions (
      jti TEXT PRIMARY KEY,
      expires_at_ms INTEGER NOT NULL
    );
  `);
  dbInstance = db;
  return db;
}

function hmacSign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function pruneExpiredRecords(nowMs = Date.now()): void {
  const db = getDb();
  // Retain consumed sessions for 24h after expiry as replay-audit barrier; delete old records thereafter
  const retentionCutoff = nowMs - 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM verification_sessions WHERE expires_at_ms < ?').run(retentionCutoff);
  db.prepare('DELETE FROM consumed_parent_assertions WHERE expires_at_ms < ?').run(nowMs);
}

/**
 * Verifies trusted parent VTU application authentication and extracts verified
 * { studentId, qrSessionId }. Never trusts an unauthenticated browser-supplied studentId.
 */
export function authenticateParentSessionRequest(params: {
  authorizationHeader?: string;
  parentAssertionToken?: string;
  bodyStudentId?: string;
  bodyQrSessionId?: string;
}):
  | { ok: true; studentId: string; qrSessionId: string }
  | { ok: false; statusCode: number; error: string } {
  const cfg = getSecurityConfig();

  // Option A: Trusted Parent Server-to-Server Bearer credential
  const bearer = params.authorizationHeader?.replace(/^Bearer\s+/i, '').trim() || '';
  if (bearer && constantTimeEquals(bearer, cfg.parentAppAuthSecret)) {
    const studentId = String(params.bodyStudentId || '').trim();
    const qrSessionId = String(params.bodyQrSessionId || '').trim();
    if (!studentId || !qrSessionId) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Authenticated parent requests must include both studentId and qrSessionId.',
      };
    }
    return { ok: true, studentId, qrSessionId };
  }

  // Option B: Short-lived HMAC-signed parent assertion token minted by VTU backend for an authenticated user
  const assertion = params.parentAssertionToken?.trim() || '';
  if (assertion) {
    const parts = assertion.split('.');
    if (parts.length !== 2) {
      return { ok: false, statusCode: 401, error: 'Malformed parentAssertionToken.' };
    }
    const [encoded, sig] = parts;
    const expected = hmacSign(encoded, cfg.parentAppAuthSecret);
    if (!constantTimeEquals(sig, expected)) {
      return { ok: false, statusCode: 401, error: 'Invalid parentAssertionToken signature.' };
    }

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
        studentId?: string;
        qrSessionId?: string;
        exp?: number;
        jti?: string;
      };
      const now = Date.now();
      if (!payload.studentId || !payload.qrSessionId || !payload.exp || !payload.jti) {
        return { ok: false, statusCode: 400, error: 'Incomplete parentAssertionToken claims.' };
      }
      if (payload.exp <= now) {
        return { ok: false, statusCode: 401, error: 'parentAssertionToken has expired.' };
      }

      const db = getDb();
      try {
        db.prepare(
          'INSERT INTO consumed_parent_assertions (jti, expires_at_ms) VALUES (?, ?)'
        ).run(payload.jti, payload.exp);
      } catch {
        return {
          ok: false,
          statusCode: 409,
          error: 'parentAssertionToken has already been redeemed.',
        };
      }

      return {
        ok: true,
        studentId: String(payload.studentId).trim(),
        qrSessionId: String(payload.qrSessionId).trim(),
      };
    } catch {
      return { ok: false, statusCode: 400, error: 'Corrupted parentAssertionToken payload.' };
    }
  }

  return {
    ok: false,
    statusCode: 401,
    error:
      'Trusted parent VTU application authentication is required to issue a verification session.',
  };
}

export function issueVerificationSession(params: {
  studentId: string;
  qrSessionId: string;
  requestedSessionId?: string;
}): VerificationSessionDescriptor {
  const cfg = getSecurityConfig();
  const db = getDb();
  const nowMs = Date.now();
  pruneExpiredRecords(nowMs);

  const cleanStudentId = params.studentId.trim();
  const cleanQrId = params.qrSessionId.trim();
  const verificationSessionId =
    params.requestedSessionId?.trim() ||
    `VTU-VS-${nowMs}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

  const challenge = CHALLENGES[crypto.randomInt(0, CHALLENGES.length)];
  const challengeNonce = crypto.randomBytes(12).toString('hex');
  const expiresAtMs = nowMs + cfg.sessionTtlSec * 1000;

  try {
    db.prepare(
      `INSERT INTO verification_sessions (
        verification_session_id, student_id, qr_session_id, challenge_type, challenge_nonce, issued_at_ms, expires_at_ms, consumed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      verificationSessionId,
      cleanStudentId,
      cleanQrId,
      challenge.type,
      challengeNonce,
      nowMs,
      expiresAtMs
    );
  } catch {
    throw new Error(
      `Verification session "${verificationSessionId}" already exists. Provide a fresh session ID.`
    );
  }

  const tokenPayload = JSON.stringify({
    sid: verificationSessionId,
    stu: cleanStudentId,
    qrs: cleanQrId,
    ch: challenge.type,
    cnonce: challengeNonce,
    exp: expiresAtMs,
  });
  const encodedPayload = Buffer.from(tokenPayload, 'utf8').toString('base64url');
  const sig = hmacSign(encodedPayload, cfg.verificationSessionSecret);

  return {
    verificationSessionId,
    studentId: cleanStudentId,
    qrSessionId: cleanQrId,
    challengeType: challenge.type,
    challengeInstruction: challenge.instruction,
    challengeNonce,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    sessionToken: `${encodedPayload}.${sig}`,
  };
}

/**
 * Verifies signed sessionToken AND atomically marks the session consumed in SQLite.
 * Prevents tampering, expired sessions, replay attacks, and concurrent double-submission.
 */
export function validateAndConsumeSession(params: {
  verificationSessionId: string;
  sessionToken: string;
}):
  | {
      ok: true;
      studentId: string;
      qrSessionId: string;
      challengeType: LivenessChallengeType;
      challengeNonce: string;
    }
  | { ok: false; statusCode: number; error: string } {
  const cfg = getSecurityConfig();
  const db = getDb();
  const nowMs = Date.now();
  pruneExpiredRecords(nowMs);

  const cleanSid = String(params.verificationSessionId || '').trim();
  const token = String(params.sessionToken || '').trim();

  if (!cleanSid || !token) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Both verificationSessionId and signed sessionToken are required.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, statusCode: 401, error: 'Malformed sessionToken.' };
  }
  const [encodedPayload, sig] = parts;
  const expectedSig = hmacSign(encodedPayload, cfg.verificationSessionSecret);
  if (!constantTimeEquals(sig, expectedSig)) {
    return { ok: false, statusCode: 401, error: 'Invalid sessionToken signature.' };
  }

  let parsed: {
    sid?: string;
    stu?: string;
    qrs?: string;
    ch?: LivenessChallengeType;
    cnonce?: string;
    exp?: number;
  };
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, statusCode: 400, error: 'Corrupted sessionToken payload.' };
  }

  if (!parsed.sid || !parsed.stu || !parsed.qrs || !parsed.ch || !parsed.cnonce || !parsed.exp) {
    return { ok: false, statusCode: 400, error: 'Incomplete sessionToken claims.' };
  }
  if (parsed.sid !== cleanSid) {
    return { ok: false, statusCode: 403, error: 'sessionToken does not match verificationSessionId.' };
  }
  if (parsed.exp <= nowMs) {
    return { ok: false, statusCode: 410, error: 'Verification session has expired.' };
  }

  // Atomic SQLite update: succeeds ONLY if session exists, matches claims, is unconsumed, and is unexpired
  const updateRes = db
    .prepare(
      `UPDATE verification_sessions
       SET consumed_at_ms = ?
       WHERE verification_session_id = ?
         AND student_id = ?
         AND qr_session_id = ?
         AND challenge_type = ?
         AND challenge_nonce = ?
         AND consumed_at_ms IS NULL
         AND expires_at_ms > ?`
    )
    .run(nowMs, cleanSid, parsed.stu, parsed.qrs, parsed.ch, parsed.cnonce, nowMs);

  if (Number(updateRes.changes) === 1) {
    return {
      ok: true,
      studentId: parsed.stu,
      qrSessionId: parsed.qrs,
      challengeType: parsed.ch,
      challengeNonce: parsed.cnonce,
    };
  }

  // Diagnose exact rejection reason for clean audit response
  const row = db
    .prepare(
      'SELECT expires_at_ms, consumed_at_ms FROM verification_sessions WHERE verification_session_id = ?'
    )
    .get(cleanSid) as { expires_at_ms: number; consumed_at_ms: number | null } | undefined;

  if (!row) {
    return { ok: false, statusCode: 404, error: 'Unknown verification session.' };
  }
  if (row.consumed_at_ms !== null) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Verification session or token has already been used.',
    };
  }
  if (row.expires_at_ms <= nowMs) {
    return { ok: false, statusCode: 410, error: 'Verification session has expired.' };
  }

  return { ok: false, statusCode: 403, error: 'Verification session claim mismatch.' };
}

export function validateSessionReadonly(params: {
  verificationSessionId: string;
  sessionToken: string;
}):
  | {
      ok: true;
      studentId: string;
      qrSessionId: string;
      challengeType: LivenessChallengeType;
      challengeNonce: string;
    }
  | { ok: false; statusCode: number; error: string } {
  const cfg = getSecurityConfig();
  const db = getDb();
  const nowMs = Date.now();
  pruneExpiredRecords(nowMs);

  const cleanSid = String(params.verificationSessionId || '').trim();
  const token = String(params.sessionToken || '').trim();

  if (!cleanSid || !token) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Both verificationSessionId and signed sessionToken are required.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, statusCode: 401, error: 'Malformed sessionToken.' };
  }
  const [encodedPayload, sig] = parts;
  const expectedSig = hmacSign(encodedPayload, cfg.verificationSessionSecret);
  if (!constantTimeEquals(sig, expectedSig)) {
    return { ok: false, statusCode: 401, error: 'Invalid sessionToken signature.' };
  }

  let parsed: {
    sid?: string;
    stu?: string;
    qrs?: string;
    ch?: LivenessChallengeType;
    cnonce?: string;
    exp?: number;
  };
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, statusCode: 400, error: 'Corrupted sessionToken payload.' };
  }

  if (!parsed.sid || !parsed.stu || !parsed.qrs || !parsed.ch || !parsed.cnonce || !parsed.exp) {
    return { ok: false, statusCode: 400, error: 'Incomplete sessionToken claims.' };
  }
  if (parsed.sid !== cleanSid) {
    return { ok: false, statusCode: 403, error: 'sessionToken does not match verificationSessionId.' };
  }
  if (parsed.exp <= nowMs) {
    return { ok: false, statusCode: 410, error: 'Verification session has expired.' };
  }

  const row = db
    .prepare(
      `SELECT verification_session_id, consumed_at_ms, expires_at_ms
       FROM verification_sessions
       WHERE verification_session_id = ?
         AND student_id = ?
         AND qr_session_id = ?`
    )
    .get(cleanSid, parsed.stu, parsed.qrs) as
    | { verification_session_id: string; consumed_at_ms: number | null; expires_at_ms: number }
    | undefined;

  if (!row) {
    return { ok: false, statusCode: 404, error: 'Verification session not found.' };
  }
  if (row.consumed_at_ms) {
    return { ok: false, statusCode: 409, error: 'Verification session has already been consumed.' };
  }
  if (row.expires_at_ms <= nowMs) {
    return { ok: false, statusCode: 410, error: 'Verification session has expired.' };
  }

  return {
    ok: true,
    studentId: parsed.stu,
    qrSessionId: parsed.qrs,
    challengeType: parsed.ch,
    challengeNonce: parsed.cnonce,
  };
}

export function signVerificationResult(
  resultWithoutSig: Omit<VerificationResult, 'resultSignature'>
): VerificationResult {
  const cfg = getSecurityConfig();
  const canonical = JSON.stringify({
    studentId: resultWithoutSig.studentId,
    qrSessionId: resultWithoutSig.qrSessionId,
    verificationSessionId: resultWithoutSig.verificationSessionId,
    challengeType: resultWithoutSig.challengeType,
    faceDetected: resultWithoutSig.faceDetected,
    faceMatch: resultWithoutSig.faceMatch,
    blinkDetected: resultWithoutSig.blinkDetected,
    livenessVerified: resultWithoutSig.livenessVerified,
    verificationStatus: resultWithoutSig.verificationStatus,
    modelId: resultWithoutSig.modelId,
    modelVersion: resultWithoutSig.modelVersion,
    verifiedAt: resultWithoutSig.verifiedAt,
  });
  const sig = hmacSign(canonical, cfg.verificationSessionSecret);
  return {
    ...resultWithoutSig,
    resultSignature: sig,
  };
}

export function verifyResultSignature(result: VerificationResult): boolean {
  const { resultSignature, ...rest } = result;
  if (!resultSignature) return false;
  const expected = signVerificationResult(rest);
  return constantTimeEquals(resultSignature, expected.resultSignature);
}
