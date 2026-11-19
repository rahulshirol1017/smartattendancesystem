import {
  EnrolledSubjectRecord,
  IdentificationCandidate,
  RecognitionModelId,
} from '../src/shared/types.ts';
import { getSecurityConfig } from './config.ts';

/**
 * Biometric Matching, Unknown/Ambiguity Rejection & Threshold Calibration Engine
 *
 * Strictly enforces matching modelId & modelVersion so incompatible embeddings are never compared.
 */

export const EXPECTED_ARCFACE_DIM = 512;

export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-8) {
    throw new Error('Cannot normalize zero-norm facial embedding.');
  }
  return vec.map((v) => v / norm);
}

export function validateDescriptorVector(
  vec: unknown,
  expectedDim = EXPECTED_ARCFACE_DIM
): number[] | null {
  if (!Array.isArray(vec) || vec.length !== expectedDim) {
    return null;
  }
  const clean: number[] = [];
  let normSq = 0;
  for (const val of vec) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return null;
    }
    clean.push(val);
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  if (norm < 0.1 || norm > 50.0) {
    return null;
  }
  return normalizeVector(clean);
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch (${a.length} vs ${b.length}).`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch (${a.length} vs ${b.length}).`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function computeCentroidDescriptor(descriptors: number[][]): number[] {
  if (descriptors.length === 0) return [];
  const dims = descriptors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const desc of descriptors) {
    if (desc.length !== dims) {
      throw new Error('All descriptors for a centroid must share the same dimension.');
    }
    const unit = normalizeVector(desc);
    for (let i = 0; i < dims; i++) {
      sum[i] += unit[i];
    }
  }
  return normalizeVector(sum);
}

export function evaluateFaceMatch(
  liveDescriptor: number[],
  referenceEmbeddings: number[][],
  customThreshold?: number
): {
  faceMatch: 'MATCH' | 'NO_MATCH';
  modelId: RecognitionModelId;
  modelVersion: string;
  bestDistance: number;
  cosineSimilarity: number;
  thresholdUsed: number;
  confidenceScore: number;
} {
  if (referenceEmbeddings.length === 0) {
    throw new Error('At least one reference facial embedding is required.');
  }

  const cfg = getSecurityConfig();
  const unitLive = normalizeVector(liveDescriptor);
  const unitRefs = referenceEmbeddings.map(normalizeVector);
  const thresholdUsed = customThreshold ?? cfg.arcfaceCosineThreshold;

  let minDistance = Infinity;
  let maxCosine = -1;

  for (const refVec of unitRefs) {
    const d = euclideanDistance(unitLive, refVec);
    const c = cosineSimilarity(unitLive, refVec);
    if (d < minDistance) minDistance = d;
    if (c > maxCosine) maxCosine = c;
  }

  const centroid = computeCentroidDescriptor(unitRefs);
  const centroidDistance = euclideanDistance(unitLive, centroid);
  const centroidCosine = cosineSimilarity(unitLive, centroid);

  const effectiveDistance = Math.min(minDistance, centroidDistance);
  const effectiveCosine = Math.max(maxCosine, centroidCosine);

  const confidenceScore = Math.max(
    0,
    Math.min(100, Math.round(((effectiveCosine - 0.05) / 0.7) * 100))
  );

  return {
    faceMatch: effectiveCosine >= thresholdUsed ? 'MATCH' : 'NO_MATCH',
    modelId: cfg.expectedModelId,
    modelVersion: cfg.expectedModelVersion,
    bestDistance: Number(effectiveDistance.toFixed(4)),
    cosineSimilarity: Number(effectiveCosine.toFixed(4)),
    thresholdUsed,
    confidenceScore,
  };
}

/**
 * 1:N Identification across unlimited enrolled subjects with model-version isolation,
 * unknown-face rejection, and top-1 vs top-2 ambiguity rejection.
 */
export function identifyEnrolledSubject(
  liveDescriptor: number[],
  subjects: EnrolledSubjectRecord[],
  thresholdOverride?: number
): {
  status: 'IDENTIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
  matchedSubjectId: string | null;
  matchedDisplayName?: string;
  topSimilarity: number | null;
  secondSimilarity: number | null;
  thresholdUsed: number;
  candidates: IdentificationCandidate[];
  reason: string | null;
} {
  const cfg = getSecurityConfig();
  const unitLive = normalizeVector(liveDescriptor);
  const threshold = thresholdOverride ?? cfg.arcfaceCosineThreshold;

  // Enforce strict modelVersion compatibility
  const compatibleSubjects = subjects.filter(
    (s) =>
      s.modelVersion === cfg.expectedModelVersion && s.embeddingDim === unitLive.length
  );

  if (compatibleSubjects.length === 0) {
    return {
      status: 'UNKNOWN',
      matchedSubjectId: null,
      topSimilarity: null,
      secondSimilarity: null,
      thresholdUsed: threshold,
      candidates: [],
      reason: `No enrolled subjects compatible with ${cfg.expectedModelVersion}.`,
    };
  }

  const scored: IdentificationCandidate[] = compatibleSubjects.map((subj) => {
    const evalRes = evaluateFaceMatch(unitLive, subj.embeddings, threshold);
    return {
      subjectId: subj.subjectId,
      displayName: subj.displayName,
      cosineSimilarity: evalRes.cosineSimilarity,
      euclideanDistance: evalRes.bestDistance,
    };
  });

  scored.sort((a, b) => b.cosineSimilarity - a.cosineSimilarity);
  const top1 = scored[0];
  const top2 = scored[1] || null;

  if (top1.cosineSimilarity < threshold) {
    return {
      status: 'UNKNOWN',
      matchedSubjectId: null,
      topSimilarity: top1.cosineSimilarity,
      secondSimilarity: top2?.cosineSimilarity ?? null,
      thresholdUsed: threshold,
      candidates: scored.slice(0, 5),
      reason: `Unknown identity rejected (top cosine ${top1.cosineSimilarity} < threshold ${threshold}).`,
    };
  }

  if (top2 && top1.cosineSimilarity - top2.cosineSimilarity < cfg.arcfaceAmbiguityMargin) {
    return {
      status: 'AMBIGUOUS',
      matchedSubjectId: null,
      topSimilarity: top1.cosineSimilarity,
      secondSimilarity: top2.cosineSimilarity,
      thresholdUsed: threshold,
      candidates: scored.slice(0, 5),
      reason: `Ambiguous match between ${top1.subjectId} (${top1.cosineSimilarity}) and ${top2.subjectId} (${top2.cosineSimilarity}).`,
    };
  }

  return {
    status: 'IDENTIFIED',
    matchedSubjectId: top1.subjectId,
    matchedDisplayName: top1.displayName,
    topSimilarity: top1.cosineSimilarity,
    secondSimilarity: top2?.cosineSimilarity ?? null,
    thresholdUsed: threshold,
    candidates: scored.slice(0, 5),
    reason: null,
  };
}

export function evaluateThresholdMetrics(
  samples: Array<{ subjectId: string; embedding: number[] }>
): {
  sampleCount: number;
  subjectCount: number;
  genuinePairs: number;
  impostorPairs: number;
  recommendedThreshold: number;
  eer: number;
  sweep: Array<{ threshold: number; far: number; frr: number; tar: number }>;
} {
  if (samples.length < 4) {
    throw new Error('At least 4 real labeled samples across >= 2 subjects are required.');
  }

  const normalized = samples.map((s) => ({
    subjectId: s.subjectId.trim(),
    embedding: normalizeVector(s.embedding),
  }));

  const uniqueSubjects = new Set(normalized.map((s) => s.subjectId));
  if (uniqueSubjects.size < 2) {
    throw new Error('Validation evaluation requires at least 2 distinct subjects.');
  }

  const genuineScores: number[] = [];
  const impostorScores: number[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const sim = cosineSimilarity(normalized[i].embedding, normalized[j].embedding);
      if (normalized[i].subjectId === normalized[j].subjectId) {
        genuineScores.push(sim);
      } else {
        impostorScores.push(sim);
      }
    }
  }

  if (genuineScores.length === 0 || impostorScores.length === 0) {
    throw new Error('Validation set must contain both genuine and impostor pairs.');
  }

  const sweep: Array<{ threshold: number; far: number; frr: number; tar: number }> = [];
  let bestDiff = Infinity;
  let recommendedThreshold = 0.4;
  let eer = 0;

  for (let t = 0.2; t <= 0.7501; t += 0.02) {
    const threshold = Number(t.toFixed(2));
    const falseAccepts = impostorScores.filter((s) => s >= threshold).length;
    const falseRejects = genuineScores.filter((s) => s < threshold).length;
    const far = Number((falseAccepts / impostorScores.length).toFixed(4));
    const frr = Number((falseRejects / genuineScores.length).toFixed(4));
    const tar = Number((1 - frr).toFixed(4));
    sweep.push({ threshold, far, frr, tar });

    const diff = Math.abs(far - frr);
    if (diff < bestDiff) {
      bestDiff = diff;
      recommendedThreshold = threshold;
      eer = Number(((far + frr) / 2).toFixed(4));
    }
  }

  return {
    sampleCount: normalized.length,
    subjectCount: uniqueSubjects.size,
    genuinePairs: genuineScores.length,
    impostorPairs: impostorScores.length,
    recommendedThreshold,
    eer,
    sweep,
  };
}
