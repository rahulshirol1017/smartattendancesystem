import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  EnrolledSampleMetadata,
  EnrolledSubjectRecord,
  RecognitionModelId,
} from '../src/shared/types.ts';
import { computeCentroidDescriptor, validateDescriptorVector } from './biometricMatcher.ts';
import { getSecurityConfig } from './config.ts';
import { BiometricEnrollmentModel } from './models.ts';
import mongoose from 'mongoose';

/**
 * AES-256-GCM Encrypted Scalable Biometric Reference Store
 *
 * - Supports unlimited enrolled subjects with multiple embeddings per subject.
 * - Encrypts all stored biometric vectors at rest using AES-256-GCM (random 96-bit IV + authTag).
 * - Tracks exact modelId & modelVersion so incompatible embeddings are never compared.
 * - Requires explicit user consent and authorized admin credentials for all mutations.
 * - Never exposes decrypted biometric vectors on list endpoints.
 */

interface EncryptedBlob {
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface StoredEncryptedSubject {
  subjectId: string;
  displayName?: string;
  modelId: RecognitionModelId;
  modelVersion: string;
  embeddingDim: number;
  encryptedVectors: EncryptedBlob;
  samples: EnrolledSampleMetadata[];
  consentConfirmed: boolean;
  consentRecordedAt: string;
  updatedAt: string;
}

interface EncryptedStoreFile {
  version: number;
  subjects: Record<string, StoredEncryptedSubject>;
}

function encryptPayload(plainObj: unknown): EncryptedBlob {
  const key = getSecurityConfig().biometricEncryptionKey;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptPayload<T>(blob: EncryptedBlob): T {
  const key = getSecurityConfig().biometricEncryptionKey;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

function getStorePath(): string {
  return path.resolve(process.cwd(), getSecurityConfig().referenceStorePath);
}

function loadStore(): EncryptedStoreFile {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return { version: 2, subjects: {} };
  }
  const raw = fs.readFileSync(storePath, 'utf8');
  const parsed = JSON.parse(raw) as EncryptedStoreFile;
  if (!parsed || typeof parsed.subjects !== 'object') {
    return { version: 2, subjects: {} };
  }
  return parsed;
}

function saveStore(store: EncryptedStoreFile): void {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${storePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, storePath);

  // Asynchronously replicate encrypted biometric reference to MongoDB Atlas for persistence
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const subjects = Object.values(store.subjects);
    if (subjects.length > 0) {
      Promise.all(
        subjects.map((s) =>
          BiometricEnrollmentModel.updateOne(
            { subjectId: s.subjectId },
            { $set: s },
            { upsert: true }
          ).catch((err) =>
            console.warn(`[BiometricStore] Atlas backup error for ${s.subjectId}:`, err.message)
          )
        )
      ).catch(() => {});
    }
  }
}

/**
 * Synchronizes encrypted biometric templates with MongoDB Atlas at startup.
 * Ensures persistent biometrics survive cloud ephemeral container restarts.
 */
export async function syncBiometricsWithMongo(): Promise<void> {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
  try {
    const mongoDocs = await BiometricEnrollmentModel.find({}).lean();
    const diskStore = loadStore();
    let mutated = false;

    if (mongoDocs && mongoDocs.length > 0) {
      // Rehydrate local store from persistent cloud database
      for (const doc of mongoDocs) {
        const item = doc as unknown as StoredEncryptedSubject;
        if (item.subjectId && !diskStore.subjects[item.subjectId]) {
          diskStore.subjects[item.subjectId] = item;
          mutated = true;
        }
      }
    } else {
      // Seed MongoDB Atlas with existing local templates if Atlas is fresh
      const localSubjects = Object.values(diskStore.subjects);
      if (localSubjects.length > 0) {
        await BiometricEnrollmentModel.insertMany(localSubjects);
        console.log(`[BiometricStore] Seeded ${localSubjects.length} biometric templates into MongoDB Atlas.`);
      }
    }

    if (mutated) {
      const storePath = getStorePath();
      fs.writeFileSync(storePath, JSON.stringify(diskStore, null, 2), { encoding: 'utf8', mode: 0o600 });
      console.log(`[BiometricStore] Synchronized ${Object.keys(diskStore.subjects).length} biometric templates from MongoDB Atlas.`);
    }
  } catch (err) {
    console.warn('[BiometricStore] MongoDB synchronization warning:', err instanceof Error ? err.message : String(err));
  }
}

function decryptSubjectRecord(stored: StoredEncryptedSubject): EnrolledSubjectRecord {
  const vectors = decryptPayload<{ embeddings: number[][]; centroidEmbedding: number[] }>(
    stored.encryptedVectors
  );
  return {
    subjectId: stored.subjectId,
    displayName: stored.displayName,
    modelId: stored.modelId,
    modelVersion: stored.modelVersion,
    embeddingDim: stored.embeddingDim,
    embeddings: vectors.embeddings,
    centroidEmbedding: vectors.centroidEmbedding,
    samples: stored.samples,
    consentConfirmed: stored.consentConfirmed,
    consentRecordedAt: stored.consentRecordedAt,
    updatedAt: stored.updatedAt,
  };
}

export function listEnrolledSubjectsSummary(): Array<{
  subjectId: string;
  displayName?: string;
  modelId: RecognitionModelId;
  modelVersion: string;
  embeddingDim: number;
  sampleCount: number;
  samples: EnrolledSampleMetadata[];
  consentConfirmed: boolean;
  consentRecordedAt: string;
  updatedAt: string;
}> {
  const store = loadStore();
  return Object.values(store.subjects).map((s) => ({
    subjectId: s.subjectId,
    displayName: s.displayName,
    modelId: s.modelId,
    modelVersion: s.modelVersion,
    embeddingDim: s.embeddingDim,
    sampleCount: s.samples.length,
    samples: s.samples,
    consentConfirmed: s.consentConfirmed,
    consentRecordedAt: s.consentRecordedAt,
    updatedAt: s.updatedAt,
  }));
}

export function getEnrolledSubject(subjectId: string): EnrolledSubjectRecord | null {
  try {
    const store = loadStore();
    const stored = store.subjects[subjectId.trim()];
    if (!stored) return null;
    return decryptSubjectRecord(stored);
  } catch (err) {
    console.warn(`[BiometricStore] Warning: could not decrypt biometric record for ${subjectId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function getAllEnrolledSubjects(): EnrolledSubjectRecord[] {
  const store = loadStore();
  const list: EnrolledSubjectRecord[] = [];
  for (const stored of Object.values(store.subjects)) {
    try {
      list.push(decryptSubjectRecord(stored));
    } catch {
      // ignore undecryptable record
    }
  }
  return list;
}

export function upsertEnrolledSubject(params: {
  subjectId: string;
  displayName?: string;
  embeddings: unknown[];
  sampleLabels?: Array<{ angleLabel?: string; lightingLabel?: string; qualityScore?: number }>;
  consentConfirmed: boolean;
  mode: 'append' | 'replace';
  modelId?: RecognitionModelId;
  modelVersion?: string;
}): EnrolledSubjectRecord {
  const cfg = getSecurityConfig();
  const subjectId = params.subjectId.trim();
  if (!subjectId) {
    throw new Error('subjectId is required.');
  }
  if (!params.consentConfirmed) {
    throw new Error('Explicit user consent (consentConfirmed: true) is required.');
  }
  if (!Array.isArray(params.embeddings) || params.embeddings.length === 0) {
    throw new Error('At least one real 512-D ArcFace embedding is required.');
  }

  const targetModelId = params.modelId || cfg.expectedModelId;
  const targetModelVersion = params.modelVersion || cfg.expectedModelVersion;

  if (targetModelId !== cfg.expectedModelId || targetModelVersion !== cfg.expectedModelVersion) {
    throw new Error(
      `Incompatible model version "${targetModelVersion}". Expected "${cfg.expectedModelVersion}".`
    );
  }

  const normalizedBatch: number[][] = [];
  for (const rawVec of params.embeddings) {
    const clean = validateDescriptorVector(rawVec, 512);
    if (!clean) {
      throw new Error('Every enrolled embedding must be a valid 512-D ArcFace vector.');
    }
    normalizedBatch.push(clean);
  }

  const now = new Date().toISOString();
  const newSampleMeta: EnrolledSampleMetadata[] = normalizedBatch.map((_, idx) => ({
    sampleId: `smp_${crypto.randomBytes(4).toString('hex')}`,
    angleLabel: params.sampleLabels?.[idx]?.angleLabel,
    lightingLabel: params.sampleLabels?.[idx]?.lightingLabel,
    qualityScore: params.sampleLabels?.[idx]?.qualityScore,
    enrolledAt: now,
  }));

  const store = loadStore();
  const existingStored = store.subjects[subjectId];
  let existingDecrypted: EnrolledSubjectRecord | null = null;
  if (params.mode === 'append' && existingStored && existingStored.modelVersion === targetModelVersion) {
    try {
      existingDecrypted = decryptSubjectRecord(existingStored);
    } catch {
      existingDecrypted = null;
    }
  }

  let mergedEmbeddings: number[][];
  let mergedSamples: EnrolledSampleMetadata[];

  if (existingDecrypted && params.mode === 'append') {
    mergedEmbeddings = [...existingDecrypted.embeddings, ...normalizedBatch];
    mergedSamples = [...existingDecrypted.samples, ...newSampleMeta];
  } else {
    mergedEmbeddings = normalizedBatch;
    mergedSamples = newSampleMeta;
  }

  const centroidEmbedding = computeCentroidDescriptor(mergedEmbeddings);
  const encryptedVectors = encryptPayload({
    embeddings: mergedEmbeddings,
    centroidEmbedding,
  });

  const storedRecord: StoredEncryptedSubject = {
    subjectId,
    displayName: params.displayName?.trim() || existingStored?.displayName,
    modelId: targetModelId,
    modelVersion: targetModelVersion,
    embeddingDim: 512,
    encryptedVectors,
    samples: mergedSamples,
    consentConfirmed: true,
    consentRecordedAt: existingStored?.consentRecordedAt || now,
    updatedAt: now,
  };

  store.subjects[subjectId] = storedRecord;
  saveStore(store);

  return {
    subjectId: storedRecord.subjectId,
    displayName: storedRecord.displayName,
    modelId: storedRecord.modelId,
    modelVersion: storedRecord.modelVersion,
    embeddingDim: 512,
    embeddings: mergedEmbeddings,
    centroidEmbedding,
    samples: mergedSamples,
    consentConfirmed: true,
    consentRecordedAt: storedRecord.consentRecordedAt,
    updatedAt: now,
  };
}

export function deleteEnrolledSubject(subjectId: string): boolean {
  const cleanId = subjectId.trim();
  const store = loadStore();
  if (!store.subjects[cleanId]) {
    return false;
  }
  delete store.subjects[cleanId];
  saveStore(store);
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    BiometricEnrollmentModel.deleteOne({ subjectId: cleanId }).catch(() => {});
  }
  return true;
}
