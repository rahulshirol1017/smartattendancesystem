import 'dotenv/config';
import crypto from 'crypto';

/**
 * Security & Runtime Configuration
 *
 * - Zero hardcoded static secret strings.
 * - Production mode MUST fail closed at startup if any required secret is absent or weak.
 * - Development mode generates ephemeral per-process CSPRNG keys when env vars are unset
 *   and logs an explicit warning.
 */

export interface SecurityConfig {
  isProduction: boolean;
  verificationSessionSecret: string;
  parentAppAuthSecret: string;
  biometricEncryptionKey: Buffer;
  enrollmentAdminKey: string;
  sessionTtlSec: number;
  arcfaceCosineThreshold: number;
  arcfaceAmbiguityMargin: number;
  expectedModelId: 'arcface-w600k-mbf-512d';
  expectedModelVersion: string;
  verificationDbPath: string;
  referenceStorePath: string;
  allowedParentOrigin: string;
}

let cachedConfig: SecurityConfig | null = null;

function validateSecretOrEphemeral(name: string, isProduction: boolean): string {
  const val = process.env[name]?.trim();
  const looksPlaceholder =
    !val ||
    val.length < 16 ||
    val.startsWith('replace-with-');

  if (!looksPlaceholder) {
    return val;
  }

  if (isProduction) {
    throw new Error(
      `FATAL SECURITY ERROR: Environment variable "${name}" must be configured (>= 16 random characters) in production.`
    );
  }

  const ephemeral = crypto.randomBytes(32).toString('hex');
  console.warn(
    `[SECURITY WARNING] "${name}" is not set (or uses placeholder) in dev mode. Generated an ephemeral per-process secret; configure "${name}" in .env before production deployment.`
  );
  return ephemeral;
}

export function getSecurityConfig(): SecurityConfig {
  if (cachedConfig) return cachedConfig;

  const isProduction = process.env.NODE_ENV === 'production';
  const verificationSessionSecret = validateSecretOrEphemeral(
    'VERIFICATION_SESSION_SECRET',
    isProduction
  );
  const parentAppAuthSecret = validateSecretOrEphemeral(
    'PARENT_APP_AUTH_SECRET',
    isProduction
  );
  const biometricEncryptionRaw = validateSecretOrEphemeral(
    'BIOMETRIC_ENCRYPTION_KEY',
    isProduction
  );
  const enrollmentAdminKey = validateSecretOrEphemeral(
    'ENROLLMENT_ADMIN_KEY',
    isProduction
  );

  // Derive a 256-bit AES key deterministically from BIOMETRIC_ENCRYPTION_KEY
  const biometricEncryptionKey = crypto
    .createHash('sha256')
    .update(biometricEncryptionRaw, 'utf8')
    .digest();

  const sessionTtlSec = Math.min(
    300,
    Math.max(30, Number(process.env.VERIFICATION_SESSION_TTL_SEC) || 120)
  );
  const arcfaceCosineThreshold = Math.min(
    0.85,
    Math.max(0.2, Number(process.env.ARCFACE_COSINE_THRESHOLD) || 0.4)
  );
  const arcfaceAmbiguityMargin = Math.min(
    0.25,
    Math.max(0.01, Number(process.env.ARCFACE_AMBIGUITY_MARGIN) || 0.05)
  );

  cachedConfig = {
    isProduction,
    verificationSessionSecret,
    parentAppAuthSecret,
    biometricEncryptionKey,
    enrollmentAdminKey,
    sessionTtlSec,
    arcfaceCosineThreshold,
    arcfaceAmbiguityMargin,
    expectedModelId: 'arcface-w600k-mbf-512d',
    expectedModelVersion: 'insightface-buffalo_sc-w600k_mbf-v1',
    verificationDbPath:
      process.env.VERIFICATION_DB_PATH?.trim() || '.secure_store/verification_sessions.sqlite',
    referenceStorePath:
      process.env.REFERENCE_STORE_PATH?.trim() || '.secure_store/enrolled_references.enc.json',
    allowedParentOrigin: process.env.ALLOWED_PARENT_ORIGIN?.trim() || '',
  };

  return cachedConfig;
}
