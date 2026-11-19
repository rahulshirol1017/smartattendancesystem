import { RecognitionModelId } from '../shared/types.ts';

/**
 * Face Embedding Similarity & Client-Side Fallback Match Helpers
 *
 * Primary Model: ArcFace w600k_mbf.onnx (512-D cosine similarity >= 0.40)
 * Legacy Model: ResNet-34 128-D (Euclidean distance <= 0.48)
 */

export const ARCFACE_CLIENT_THRESHOLD = 0.4;
export const LEGACY_CLIENT_THRESHOLD = 0.48;

export function normalizeEmbedding(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => v / norm);
}

export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions must match (${a.length} vs ${b.length}).`);
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

export function computeEuclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions must match (${a.length} vs ${b.length}).`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function evaluateClientSideFaceMatch(
  liveDescriptor: number[],
  referenceEmbeddings: number[][],
  customThreshold?: number
): {
  faceMatch: 'MATCH' | 'NO_MATCH';
  modelUsed: RecognitionModelId;
  bestDistance: number;
  cosineSimilarity: number;
  thresholdUsed: number;
  confidenceScore: number;
} {
  const unitLive = normalizeEmbedding(liveDescriptor);
  const unitRefs = referenceEmbeddings.map(normalizeEmbedding);
  const isArcFace = unitLive.length === 512;

  let maxCosine = -1;
  let minDistance = Infinity;
  for (const ref of unitRefs) {
    const c = computeCosineSimilarity(unitLive, ref);
    const d = computeEuclideanDistance(unitLive, ref);
    if (c > maxCosine) maxCosine = c;
    if (d < minDistance) minDistance = d;
  }

  if (isArcFace) {
    const thresholdUsed = customThreshold ?? ARCFACE_CLIENT_THRESHOLD;
    const confidenceScore = Math.max(
      0,
      Math.min(100, Math.round(((maxCosine - 0.05) / 0.7) * 100))
    );
    return {
      faceMatch: maxCosine >= thresholdUsed ? 'MATCH' : 'NO_MATCH',
      modelUsed: 'arcface-w600k-mbf-512d',
      bestDistance: Number(minDistance.toFixed(4)),
      cosineSimilarity: Number(maxCosine.toFixed(4)),
      thresholdUsed,
      confidenceScore,
    };
  }

  const thresholdUsed = customThreshold ?? LEGACY_CLIENT_THRESHOLD;
  const confidenceScore = Math.max(
    0,
    Math.min(100, Math.round((1 - minDistance / 0.95) * 100))
  );
  return {
    faceMatch: minDistance <= thresholdUsed ? 'MATCH' : 'NO_MATCH',
    modelUsed: 'resnet34-128d',
    bestDistance: Number(minDistance.toFixed(4)),
    cosineSimilarity: Number(maxCosine.toFixed(4)),
    thresholdUsed,
    confidenceScore,
  };
}
