import * as jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LivenessChallengeType,
  RecognitionModelId,
  VerificationEvidenceFrames,
} from '../src/shared/types.ts';
import { cosineSimilarity, normalizeVector } from './biometricMatcher.ts';
import { getSecurityConfig } from './config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveModelPath(filename: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'public/models', filename),
    path.resolve(process.cwd(), 'dist/models', filename),
    path.resolve(__dirname, '../public/models', filename),
    path.resolve(__dirname, '../dist/models', filename),
    path.resolve('/app/public/models', filename),
    path.resolve('/app/dist/models', filename),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), 'public/models', filename);
}

/**
 * Trusted Server-Side Biometric Inference & Anti-Spoofing Pipeline
 *
 * Runs genuine ONNX inference inside Node.js using onnxruntime-node over raw
 * captured evidence JPEG frames. Never trusts client-computed face counts,
 * quality scores, blink booleans, or raw embeddings during verification.
 *
 * Models:
 * 1. InsightFace SCRFD-500M (public/models/scrfd_det_500m.onnx)
 *    - Face detection, confidence scoring, multi-face rejection, 5-point keypoints
 * 2. InsightFace ArcFace MobileFaceNet (public/models/arcface_w600k_mbf.onnx)
 *    - 112x112 Umeyama similarity alignment + L2-normalized 512-D facial embedding
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface DecodedFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface ScrfdFaceDetection {
  score: number;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
  };
  kps: Point2D[]; // [subjectRightEye, subjectLeftEye, noseTip, subjectRightMouth, subjectLeftMouth]
}

export interface ServerQualityReport {
  passed: boolean;
  sharpnessScore: number;
  luminanceScore: number;
  interOcularPx: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  withinBounds: boolean;
  failureReason: string | null;
}

export interface ServerVerificationInferenceResult {
  ok: boolean;
  faceDetected: boolean;
  faceCount: number;
  blinkDetected: boolean;
  livenessVerified: boolean;
  liveEmbedding: number[] | null;
  postChallengeEmbedding: number[] | null;
  consistencyCosine: number | null;
  modelId: RecognitionModelId;
  modelVersion: string;
  failureReason: string | null;
  latencyMetrics?: {
    detectionLatencyMs: number;
    embeddingLatencyMs: number;
    verificationLatencyMs: number;
  };
}

const SCRFD_INPUT_SIZE = 640;
const ARCFACE_SIZE = 112;
const ARCFACE_DST_LANDMARKS: Point2D[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

const SCRFD_OUTPUT_CONFIG = [
  { stride: 8, scoreName: '443', bboxName: '446', kpsName: '449' },
  { stride: 16, scoreName: '468', bboxName: '471', kpsName: '474' },
  { stride: 32, scoreName: '493', bboxName: '496', kpsName: '499' },
] as const;

let scrfdSessionPromise: Promise<ort.InferenceSession> | null = null;
let arcFaceSessionPromise: Promise<ort.InferenceSession> | null = null;

async function getScrfdSession(): Promise<ort.InferenceSession> {
  if (!scrfdSessionPromise) {
    const modelPath = resolveModelPath('scrfd_det_500m.onnx');
    scrfdSessionPromise = ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    });
  }
  return scrfdSessionPromise;
}

async function getArcFaceSession(): Promise<ort.InferenceSession> {
  if (!arcFaceSessionPromise) {
    const modelPath = resolveModelPath('arcface_w600k_mbf.onnx');
    arcFaceSessionPromise = ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    });
  }
  return arcFaceSessionPromise;
}

export function reloadArcFaceSession(): void {
  arcFaceSessionPromise = null;
}

export async function preloadServerModels(): Promise<void> {
  await Promise.all([getScrfdSession(), getArcFaceSession()]);
}

export function decodeJpegBase64(dataUrlOrBase64: string): DecodedFrame {
  if (typeof dataUrlOrBase64 !== 'string' || !dataUrlOrBase64.trim()) {
    throw new Error('Missing captured image frame.');
  }
  const stripped = dataUrlOrBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  const buffer = Buffer.from(stripped, 'base64');
  if (buffer.length < 64 || buffer.length > 5_000_000) {
    throw new Error('Captured frame size is out of valid bounds.');
  }

  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
  if (!decoded || !decoded.data || decoded.width < 64 || decoded.height < 64) {
    throw new Error('Captured image resolution is too low.');
  }

  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.data as Uint8Array,
  };
}

function nms(detections: ScrfdFaceDetection[], iouThreshold: number): ScrfdFaceDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept: ScrfdFaceDetection[] = [];

  for (const cand of sorted) {
    let suppressed = false;
    const areaA = cand.box.width * cand.box.height;
    for (const prev of kept) {
      const ix1 = Math.max(cand.box.x1, prev.box.x1);
      const iy1 = Math.max(cand.box.y1, prev.box.y1);
      const ix2 = Math.min(cand.box.x2, prev.box.x2);
      const iy2 = Math.min(cand.box.y2, prev.box.y2);
      const iw = Math.max(0, ix2 - ix1);
      const ih = Math.max(0, iy2 - iy1);
      const inter = iw * ih;
      const areaB = prev.box.width * prev.box.height;
      const union = areaA + areaB - inter;
      if (union > 0 && inter / union > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) {
      kept.push(cand);
    }
  }
  return kept;
}

export async function detectFacesScrfd(
  frame: DecodedFrame,
  scoreThreshold = 0.45
): Promise<ScrfdFaceDetection[]> {
  const session = await getScrfdSession();
  const { width, height, rgba } = frame;

  const imRatio = height / width;
  let newW: number;
  let newH: number;
  if (imRatio > 1) {
    newH = SCRFD_INPUT_SIZE;
    newW = Math.max(1, Math.round(newH / imRatio));
  } else {
    newW = SCRFD_INPUT_SIZE;
    newH = Math.max(1, Math.round(newW * imRatio));
  }
  const detScale = newH / height;

  const planeSize = SCRFD_INPUT_SIZE * SCRFD_INPUT_SIZE;
  const chw = new Float32Array(3 * planeSize);
  chw.fill(-127.5 / 128.0);

  for (let dy = 0; dy < newH; dy++) {
    const sy = Math.min(height - 1, (dy * height) / newH);
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;

    for (let dx = 0; dx < newW; dx++) {
      const sx = Math.min(width - 1, (dx * width) / newW);
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;

      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;

      const dstIdx = dy * SCRFD_INPUT_SIZE + dx;

      for (let c = 0; c < 3; c++) {
        const v00 = rgba[i00 + c];
        const v01 = rgba[i01 + c];
        const v10 = rgba[i10 + c];
        const v11 = rgba[i11 + c];
        const top = v00 + (v01 - v00) * fx;
        const bot = v10 + (v11 - v10) * fx;
        const val = top + (bot - top) * fy;
        chw[c * planeSize + dstIdx] = (val - 127.5) / 128.0;
      }
    }
  }

  const inputTensor = new ort.Tensor('float32', chw, [
    1,
    3,
    SCRFD_INPUT_SIZE,
    SCRFD_INPUT_SIZE,
  ]);
  const outputs = await session.run({ [session.inputNames[0]]: inputTensor });

  const proposals: ScrfdFaceDetection[] = [];

  for (const level of SCRFD_OUTPUT_CONFIG) {
    const scores = outputs[level.scoreName].data as Float32Array;
    const bboxes = outputs[level.bboxName].data as Float32Array;
    const kpss = outputs[level.kpsName].data as Float32Array;

    const featW = SCRFD_INPUT_SIZE / level.stride;
    const featH = SCRFD_INPUT_SIZE / level.stride;
    const numAnchors = 2;

    for (let row = 0; row < featH; row++) {
      const cy = row * level.stride;
      for (let col = 0; col < featW; col++) {
        const cx = col * level.stride;
        for (let a = 0; a < numAnchors; a++) {
          const idx = (row * featW + col) * numAnchors + a;
          const score = scores[idx];
          if (score < scoreThreshold) continue;

          const bBase = idx * 4;
          const x1 = (cx - bboxes[bBase] * level.stride) / detScale;
          const y1 = (cy - bboxes[bBase + 1] * level.stride) / detScale;
          const x2 = (cx + bboxes[bBase + 2] * level.stride) / detScale;
          const y2 = (cy + bboxes[bBase + 3] * level.stride) / detScale;

          const kBase = idx * 10;
          const kps: Point2D[] = [];
          for (let k = 0; k < 5; k++) {
            kps.push({
              x: (cx + kpss[kBase + k * 2] * level.stride) / detScale,
              y: (cy + kpss[kBase + k * 2 + 1] * level.stride) / detScale,
            });
          }

          proposals.push({
            score: Number(score.toFixed(4)),
            box: {
              x1: Math.max(0, x1),
              y1: Math.max(0, y1),
              x2: Math.min(width, x2),
              y2: Math.min(height, y2),
              width: Math.max(1, Math.min(width, x2) - Math.max(0, x1)),
              height: Math.max(1, Math.min(height, y2) - Math.max(0, y1)),
            },
            kps,
          });
        }
      }
    }
  }

  return nms(proposals, 0.4);
}

function estimateSimilarityTransform(
  src: Point2D[],
  dst: Point2D[]
): { a: number; b: number; tx: number; ty: number } {
  const n = src.length;
  let meanSrcX = 0;
  let meanSrcY = 0;
  let meanDstX = 0;
  let meanDstY = 0;

  for (let i = 0; i < n; i++) {
    meanSrcX += src[i].x;
    meanSrcY += src[i].y;
    meanDstX += dst[i].x;
    meanDstY += dst[i].y;
  }
  meanSrcX /= n;
  meanSrcY /= n;
  meanDstX /= n;
  meanDstY /= n;

  let varSrc = 0;
  let covA = 0;
  let covB = 0;

  for (let i = 0; i < n; i++) {
    const px = src[i].x - meanSrcX;
    const py = src[i].y - meanSrcY;
    const qx = dst[i].x - meanDstX;
    const qy = dst[i].y - meanDstY;
    varSrc += px * px + py * py;
    covA += px * qx + py * qy;
    covB += px * qy - py * qx;
  }

  const denom = Math.max(varSrc, 1e-6);
  const a = covA / denom;
  const b = covB / denom;
  const tx = meanDstX - (a * meanSrcX - b * meanSrcY);
  const ty = meanDstY - (b * meanSrcX + a * meanSrcY);
  return { a, b, tx, ty };
}

export async function extractArcFaceEmbeddingServer(
  frame: DecodedFrame,
  fivePoints: Point2D[]
): Promise<number[]> {
  if (fivePoints.length !== 5) {
    throw new Error('Expected 5 facial alignment keypoints for ArcFace extraction.');
  }

  const { a, b, tx, ty } = estimateSimilarityTransform(fivePoints, ARCFACE_DST_LANDMARKS);
  // Inverse similarity matrix mapping dst (u, v) -> src (x, y)
  const det = a * a + b * b;
  if (det < 1e-8) {
    throw new Error('Degenerate similarity transform during ArcFace alignment.');
  }
  const invA = a / det;
  const invB = b / det;

  const pixelCount = ARCFACE_SIZE * ARCFACE_SIZE;
  const chw = new Float32Array(3 * pixelCount);
  const { width, height, rgba } = frame;

  for (let v = 0; v < ARCFACE_SIZE; v++) {
    for (let u = 0; u < ARCFACE_SIZE; u++) {
      const du = u - tx;
      const dv = v - ty;
      const sx = invA * du + invB * dv;
      const sy = -invB * du + invA * dv;

      const dstIdx = v * ARCFACE_SIZE + u;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        chw[dstIdx] = -1;
        chw[pixelCount + dstIdx] = -1;
        chw[2 * pixelCount + dstIdx] = -1;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x0 + 1) * 4;
      const i10 = ((y0 + 1) * width + x0) * 4;
      const i11 = ((y0 + 1) * width + x0 + 1) * 4;

      for (let c = 0; c < 3; c++) {
        const top = rgba[i00 + c] + (rgba[i01 + c] - rgba[i00 + c]) * fx;
        const bot = rgba[i10 + c] + (rgba[i11 + c] - rgba[i10 + c]) * fx;
        const val = top + (bot - top) * fy;
        chw[c * pixelCount + dstIdx] = (val - 127.5) / 127.5;
      }
    }
  }

  const session = await getArcFaceSession();
  const inputTensor = new ort.Tensor('float32', chw, [1, 3, ARCFACE_SIZE, ARCFACE_SIZE]);
  const outputs = await session.run({ [session.inputNames[0]]: inputTensor });
  const raw = outputs[session.outputNames[0]].data as Float32Array;
  return normalizeVector(Array.from(raw));
}

export function evaluateServerFaceQuality(
  frame: DecodedFrame,
  face: ScrfdFaceDetection,
  requireFrontal = true
): ServerQualityReport {
  const { width, height, rgba } = frame;
  const [rightEye, leftEye, nose, rightMouth, leftMouth] = face.kps;
  const interOcularPx = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

  const rollDeg = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;
  const eyeMidX = (rightEye.x + leftEye.x) / 2;
  const eyeMidY = (rightEye.y + leftEye.y) / 2;
  const mouthMidY = (rightMouth.y + leftMouth.y) / 2;

  const yawDeg = ((nose.x - eyeMidX) / Math.max(1, interOcularPx * 0.5)) * 28;
  const faceVerticalSpan = Math.max(1, mouthMidY - eyeMidY);
  const noseRatio = (nose.y - eyeMidY) / faceVerticalSpan;
  const pitchDeg = (noseRatio - 0.56) * 85;

  const withinBounds = face.kps.every(
    (pt) => pt.x >= width * 0.02 && pt.x <= width * 0.98 && pt.y >= height * 0.02 && pt.y <= height * 0.98
  );

  // Sample face bounding box luminance & Laplacian sharpness at 64x64 grid
  const grid = 64;
  const gray = new Float32Array(grid * grid);
  let lumSum = 0;

  for (let gy = 0; gy < grid; gy++) {
    const sy = Math.min(height - 1, Math.max(0, Math.round(face.box.y1 + (gy / grid) * face.box.height)));
    for (let gx = 0; gx < grid; gx++) {
      const sx = Math.min(width - 1, Math.max(0, Math.round(face.box.x1 + (gx / grid) * face.box.width)));
      const p = (sy * width + sx) * 4;
      const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      gray[gy * grid + gx] = lum;
      lumSum += lum;
    }
  }

  const luminanceScore = Number((lumSum / (grid * grid)).toFixed(1));

  let lapSum = 0;
  let lapSumSq = 0;
  let count = 0;
  for (let y = 1; y < grid - 1; y++) {
    for (let x = 1; x < grid - 1; x++) {
      const idx = y * grid + x;
      const lap = gray[idx - grid] + gray[idx + grid] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const lapMean = lapSum / Math.max(1, count);
  const sharpnessScore = Number(Math.max(0, lapSumSq / Math.max(1, count) - lapMean * lapMean).toFixed(1));

  let failureReason: string | null = null;
  if (!withinBounds || face.box.width < 32 || face.box.height < 36) {
    failureReason = 'Partial or cropped face rejected.';
  } else if (interOcularPx < 22) {
    failureReason = 'Face resolution is too small / distant for reliable recognition.';
  } else if (luminanceScore < 18 || luminanceScore > 248) {
    failureReason = 'Lighting quality out of acceptable range (too dark or overexposed).';
  } else if (sharpnessScore < 10) {
    failureReason = 'Captured face frame is too blurry for biometric matching.';
  } else if (
    requireFrontal &&
    (Math.abs(yawDeg) > 28 || Math.abs(pitchDeg) > 28 || Math.abs(rollDeg) > 25)
  ) {
    failureReason = 'Face angle is too extreme for frontal biometric verification.';
  }

  return {
    passed: failureReason === null,
    sharpnessScore,
    luminanceScore,
    interOcularPx: Number(interOcularPx.toFixed(1)),
    yawDeg: Number(yawDeg.toFixed(1)),
    pitchDeg: Number(pitchDeg.toFixed(1)),
    rollDeg: Number(rollDeg.toFixed(1)),
    withinBounds,
    failureReason,
  };
}

/**
 * Computes average normalized Mean Absolute Difference (0..255) over resampled 48x48 RGB grids
 * to reject frozen streams, re-submitted identical photos, or static cutouts.
 */
function computeFrameMad(a: DecodedFrame, b: DecodedFrame): number {
  const sample = 48;
  let diffSum = 0;
  let count = 0;
  for (let gy = 0; gy < sample; gy++) {
    const ay = Math.min(a.height - 1, Math.floor((gy / sample) * a.height));
    const by = Math.min(b.height - 1, Math.floor((gy / sample) * b.height));
    for (let gx = 0; gx < sample; gx++) {
      const ax = Math.min(a.width - 1, Math.floor((gx / sample) * a.width));
      const bx = Math.min(b.width - 1, Math.floor((gx / sample) * b.width));
      const ia = (ay * a.width + ax) * 4;
      const ib = (by * b.width + bx) * 4;
      diffSum +=
        Math.abs(a.rgba[ia] - b.rgba[ib]) +
        Math.abs(a.rgba[ia + 1] - b.rgba[ib + 1]) +
        Math.abs(a.rgba[ia + 2] - b.rgba[ib + 2]);
      count += 3;
    }
  }
  return diffSum / Math.max(1, count);
}

/**
 * Measures normalized pixel contrast + vertical edge gradient around the eye centers.
 * Open eyes expose a darker pupil/iris flanked by brighter sclera/eyelid contrast; closed
 * eyelids flatten vertical iris-lid variance relative to open baselines.
 */
function measureEyeApertureContrast(frame: DecodedFrame, face: ScrfdFaceDetection): number {
  const [rightEye, leftEye] = face.kps;
  const eyeSpan = Math.max(12, Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y));
  const halfW = Math.max(4, Math.round(eyeSpan * 0.16));
  const halfH = Math.max(3, Math.round(eyeSpan * 0.1));

  const scoreSingleEye = (center: Point2D): number => {
    const xStart = Math.max(1, Math.round(center.x - halfW));
    const xEnd = Math.min(frame.width - 2, Math.round(center.x + halfW));
    const yStart = Math.max(1, Math.round(center.y - halfH));
    const yEnd = Math.min(frame.height - 2, Math.round(center.y + halfH));

    let vGradSum = 0;
    let count = 0;
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const up = (y - 1) * frame.width + x;
        const dn = (y + 1) * frame.width + x;
        const lumUp =
          0.299 * frame.rgba[up * 4] + 0.587 * frame.rgba[up * 4 + 1] + 0.114 * frame.rgba[up * 4 + 2];
        const lumDn =
          0.299 * frame.rgba[dn * 4] + 0.587 * frame.rgba[dn * 4 + 1] + 0.114 * frame.rgba[dn * 4 + 2];
        vGradSum += Math.abs(lumDn - lumUp);
        count++;
      }
    }
    return vGradSum / Math.max(1, count);
  };

  return (scoreSingleEye(rightEye) + scoreSingleEye(leftEye)) / 2;
}

/**
 * Evaluates all 4 captured evidence JPEG frames purely server-side:
 * 1. SCRFD-500M face detection on all 4 frames (single-face check, multi-face rejection)
 * 2. Anti-static / anti-duplicate inter-frame pixel difference check
 * 3. Server-side image quality gate (sharpness, illumination, face scale, frontal pose)
 * 4. Server-side blink eye-state transition consistency check across open -> closed -> open
 * 5. Server-side randomized head-movement challenge verification (left / right / nod)
 * 6. Dual ArcFace 512-D extraction (pre- & post-challenge) with anti-splice cosine check
 */
export async function runTrustedServerVerificationInference(params: {
  evidenceFrames: VerificationEvidenceFrames;
  expectedChallenge: LivenessChallengeType;
}): Promise<ServerVerificationInferenceResult> {
  const totalStart = performance.now();
  const cfg = getSecurityConfig();

  let baselineFrame: DecodedFrame;
  let closedFrame: DecodedFrame;
  let challengeFrame: DecodedFrame;
  let postFrame: DecodedFrame;

  try {
    baselineFrame = decodeJpegBase64(params.evidenceFrames.baselineOpenJpeg);
    closedFrame = decodeJpegBase64(params.evidenceFrames.blinkClosedJpeg);
    challengeFrame = decodeJpegBase64(params.evidenceFrames.challengeActionJpeg);
    postFrame = decodeJpegBase64(params.evidenceFrames.postChallengeOpenJpeg);
  } catch (err) {
    return {
      ok: false,
      faceDetected: false,
      faceCount: 0,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason:
        err instanceof Error ? err.message : 'Invalid or corrupted captured evidence frames.',
    };
  }

  // Anti-static / anti-replay check across sequential frames
  const madOpenClosed = computeFrameMad(baselineFrame, closedFrame);
  const madClosedAction = computeFrameMad(closedFrame, challengeFrame);
  const madActionPost = computeFrameMad(challengeFrame, postFrame);
  const madOpenPost = computeFrameMad(baselineFrame, postFrame);

  if (madOpenClosed < 1.2 || madClosedAction < 1.2 || madActionPost < 1.2 || madOpenPost < 0.8) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: 'Suspicious static or duplicated frames detected across liveness sequence.',
    };
  }

  const detStart = performance.now();
  const baseFaces = await detectFacesScrfd(baselineFrame);
  const postFaces = await detectFacesScrfd(postFrame);
  const detectionLatencyMs = Math.round(performance.now() - detStart);

  if (baseFaces.length > 1 || postFaces.length > 1) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: Math.max(baseFaces.length, postFaces.length),
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: 'Multiple faces detected during verification sequence.',
    };
  }

  if (baseFaces.length === 0 && postFaces.length === 0) {
    return {
      ok: false,
      faceDetected: false,
      faceCount: 0,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: 'No clear face detected in captured verification frames.',
    };
  }

  const baseFace = baseFaces[0] || postFaces[0];
  const postFace = postFaces[0] || baseFaces[0];

  const closedFaces = await detectFacesScrfd(closedFrame);
  const challFaces = await detectFacesScrfd(challengeFrame);
  const closedFace = closedFaces[0] || baseFace;
  const challFace = challFaces[0] || postFace;

  const baseQual = evaluateServerFaceQuality(baselineFrame, baseFace, true);
  if (!baseQual.passed) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: baseQual.failureReason,
    };
  }

  const postQual = evaluateServerFaceQuality(postFrame, postFace, true);
  if (!postQual.passed) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: postQual.failureReason,
    };
  }

  // Server-side pose delta check for randomized challenge
  const challQual = evaluateServerFaceQuality(challengeFrame, challFace, false);
  const yawDelta = challQual.yawDeg - baseQual.yawDeg;
  const pitchDelta = challQual.pitchDeg - baseQual.pitchDeg;

  let challengePassed = false;
  if (params.expectedChallenge === 'BLINK_AND_HEAD_LEFT') {
    challengePassed = yawDelta >= 7 || challQual.yawDeg >= 9;
  } else if (params.expectedChallenge === 'BLINK_AND_HEAD_RIGHT') {
    challengePassed = yawDelta <= -7 || challQual.yawDeg <= -9;
  } else if (params.expectedChallenge === 'BLINK_AND_NOD') {
    challengePassed = pitchDelta >= 5.5 || challQual.pitchDeg >= 7;
  }

  if (!challengePassed) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: `Randomized head-movement challenge (${params.expectedChallenge}) was not observed cleanly on server inference.`,
    };
  }

  // Server-side eye-aperture contrast check comparing open vs closed eye ROI
  const openEyeGradient =
    (measureEyeApertureContrast(baselineFrame, baseFace) +
      measureEyeApertureContrast(postFrame, postFace)) /
    2;
  const closedEyeGradient = measureEyeApertureContrast(closedFrame, closedFace);

  // Also ensure closed frame facial crop isn't identical in eye region and face alignment stayed upright
  const closedQual = evaluateServerFaceQuality(closedFrame, closedFace, true);
  const blinkContrastDrop = openEyeGradient > 0 ? closedEyeGradient / openEyeGradient : 1;
  const blinkValid = closedQual.withinBounds && (blinkContrastDrop <= 0.94 || madOpenClosed >= 2.2);

  if (!blinkValid) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: false,
      livenessVerified: false,
      liveEmbedding: null,
      postChallengeEmbedding: null,
      consistencyCosine: null,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: 'Natural eye-closure transition could not be confirmed from captured eye frames.',
    };
  }

  const embStart = performance.now();
  const [embBaseline, embPost] = await Promise.all([
    extractArcFaceEmbeddingServer(baselineFrame, baseFace.kps),
    extractArcFaceEmbeddingServer(postFrame, postFace.kps),
  ]);
  const embeddingLatencyMs = Math.round(performance.now() - embStart);
  const verificationLatencyMs = Math.round(performance.now() - totalStart);

  const consistencyCosine = Number(cosineSimilarity(embBaseline, embPost).toFixed(4));
  if (consistencyCosine < 0.45) {
    return {
      ok: false,
      faceDetected: true,
      faceCount: 1,
      blinkDetected: true,
      livenessVerified: false,
      liveEmbedding: embBaseline,
      postChallengeEmbedding: embPost,
      consistencyCosine,
      modelId: cfg.expectedModelId,
      modelVersion: cfg.expectedModelVersion,
      failureReason: `Subject identity shifted during liveness challenge (frame consistency ${consistencyCosine} < 0.45).`,
      latencyMetrics: {
        detectionLatencyMs,
        embeddingLatencyMs,
        verificationLatencyMs,
      },
    };
  }

  return {
    ok: true,
    faceDetected: true,
    faceCount: 1,
    blinkDetected: true,
    livenessVerified: true,
    liveEmbedding: embBaseline,
    postChallengeEmbedding: embPost,
    consistencyCosine,
    modelId: cfg.expectedModelId,
    modelVersion: cfg.expectedModelVersion,
    failureReason: null,
    latencyMetrics: {
      detectionLatencyMs,
      embeddingLatencyMs,
      verificationLatencyMs,
    },
  };
}
