import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FaceQualityMetrics } from '../shared/types.ts';

/**
 * Face Quality, Head Pose & 3D Depth Parallax Gate
 *
 * Ensures low-quality, blurred, partially occluded, underexposed, or steeply
 * angled frames are rejected before biometric ArcFace matching runs.
 */

export const QUALITY_THRESHOLDS = {
  minInterOcularPx: 22,
  minLuminance: 18,
  maxLuminance: 248,
  minSharpnessVariance: 10,
  maxAbsYawDeg: 30,
  maxAbsPitchDeg: 26,
  maxAbsRollDeg: 26,
};

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Estimates 3D head pose angles (yaw, pitch, roll in degrees) from MediaPipe 478 landmarks.
 */
export function estimateHeadPoseDegrees(
  landmarks: NormalizedLandmark[],
  vw: number,
  vh: number
): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  // Subject right eye outer [33], subject left eye outer [263], nose tip [1], chin [152], forehead [10]
  const rightEye = landmarks[33];
  const leftEye = landmarks[263];
  const nose = landmarks[1];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  const rx = rightEye.x * vw;
  const ry = rightEye.y * vh;
  const lx = leftEye.x * vw;
  const ly = leftEye.y * vh;

  const rollRad = Math.atan2(ly - ry, lx - rx);
  const rollDeg = (rollRad * 180) / Math.PI;

  const eyeMidX = (rx + lx) / 2;
  const eyeDist = Math.max(1, Math.hypot(lx - rx, ly - ry));
  const noseX = nose.x * vw;
  // Horizontal nose offset relative to inter-ocular span approximates yaw
  const yawDeg = ((noseX - eyeMidX) / (eyeDist * 0.5)) * 28;

  const faceHeight = Math.max(1, Math.hypot((chin.x - forehead.x) * vw, (chin.y - forehead.y) * vh));
  const eyeMidY = (ry + ly) / 2;
  const noseY = nose.y * vh;
  // Expected vertical nose-to-eye ratio ~ 0.18 of full forehead-chin height
  const noseRatio = (noseY - eyeMidY) / faceHeight;
  const pitchDeg = (noseRatio - 0.18) * 95;

  return {
    yawDeg: Number(yawDeg.toFixed(1)),
    pitchDeg: Number(pitchDeg.toFixed(1)),
    rollDeg: Number(rollDeg.toFixed(1)),
  };
}

/**
 * Measures normalized 3D nose protrusion vs cheek plane depth from MediaPipe 3D mesh.
 * Flat printed photos / tablet screens display significantly compressed depth relief.
 */
export function computeDepthParallaxScore(landmarks: NormalizedLandmark[]): number {
  const noseTip = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const leftEye = landmarks[263];
  const rightEye = landmarks[33];

  const eyeSpan = Math.max(0.01, dist2D(leftEye, rightEye));
  const avgCheekZ = (leftCheek.z + rightCheek.z) / 2;
  const relief = Math.abs(avgCheekZ - noseTip.z) / eyeSpan;
  return Number(relief.toFixed(4));
}

/**
 * Computes Laplacian variance sharpness on a cropped face box using an offscreen canvas.
 */
export function computeFaceSharpness(
  videoEl: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  scratchCanvas: HTMLCanvasElement
): number {
  if (videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    return 0;
  }

  const size = 64;
  scratchCanvas.width = size;
  scratchCanvas.height = size;
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;

  ctx.drawImage(videoEl, box.x, box.y, box.width, box.height, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const gray = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const p = i * 4;
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const idx = y * size + x;
      const lap =
        gray[idx - size] +
        gray[idx + size] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Number(Math.max(0, variance).toFixed(1));
}

export function evaluateFaceQuality(params: {
  landmarks: NormalizedLandmark[];
  fivePointsPx: Array<{ x: number; y: number }>;
  boxPx: { x: number; y: number; width: number; height: number };
  vw: number;
  vh: number;
  luminanceScore: number;
  sharpnessScore: number;
}): FaceQualityMetrics {
  const { landmarks, fivePointsPx, boxPx, vw, vh, luminanceScore, sharpnessScore } = params;

  const interOcularPx = Number(dist2D(fivePointsPx[0], fivePointsPx[1]).toFixed(1));
  const { yawDeg, pitchDeg, rollDeg } = estimateHeadPoseDegrees(landmarks, vw, vh);

  const withinBounds = fivePointsPx.every(
    (pt) => pt.x >= vw * 0.01 && pt.x <= vw * 0.99 && pt.y >= vh * 0.01 && pt.y <= vh * 0.99
  );

  let failureReason: string | null = null;
  if (!withinBounds || boxPx.width < 40 || boxPx.height < 40) {
    failureReason = 'Keep your full face inside the frame.';
  } else if (interOcularPx < QUALITY_THRESHOLDS.minInterOcularPx) {
    failureReason = 'Move slightly closer to the camera.';
  } else if (luminanceScore < QUALITY_THRESHOLDS.minLuminance) {
    failureReason = 'Lighting is too dark. Face a brighter light source.';
  } else if (luminanceScore > QUALITY_THRESHOLDS.maxLuminance) {
    failureReason = 'Scene is overexposed. Reduce harsh backlight.';
  } else if (sharpnessScore < QUALITY_THRESHOLDS.minSharpnessVariance) {
    failureReason = 'Image is slightly blurred. Hold steady briefly.';
  } else if (
    Math.abs(yawDeg) > QUALITY_THRESHOLDS.maxAbsYawDeg ||
    Math.abs(pitchDeg) > QUALITY_THRESHOLDS.maxAbsPitchDeg ||
    Math.abs(rollDeg) > QUALITY_THRESHOLDS.maxAbsRollDeg
  ) {
    failureReason = 'Look straight toward the camera.';
  }

  return {
    passed: failureReason === null,
    sharpnessScore,
    luminanceScore,
    interOcularPx,
    yawDeg,
    pitchDeg,
    rollDeg,
    withinBounds,
    failureReason,
  };
}
