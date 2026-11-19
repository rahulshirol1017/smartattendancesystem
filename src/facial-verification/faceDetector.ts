import { FaceQualityMetrics, RecognitionModelId } from '../shared/types.ts';
import type { Point2D } from './blinkLivenessDetector.ts';
import {
  computeDepthParallaxScore,
  computeFaceSharpness,
  evaluateFaceQuality,
} from './faceQuality.ts';
import { getFaceLandmarker } from './modelLoader.ts';

/**
 * Real-Time MediaPipe 478-Point Tracking & JPEG Evidence Frame Capture
 *
 * Tracks face position, eye aperture, head pose, lighting, and sharpness in real time
 * at ~30 FPS, and captures crisp unmirrored scene frames for trusted server-side
 * SCRFD-500M + ArcFace 512-D ONNX verification.
 */

export interface FacePositionGuidance {
  faceCount: number;
  singleFaceOk: boolean;
  centeredOk: boolean;
  sizeOk: boolean;
  lightingOk: boolean;
  guidanceMessage: string;
}

export interface TrackedFaceFrame {
  faceCount: number;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  leftEyePoints: Point2D[];
  rightEyePoints: Point2D[];
  alignmentFivePoints: Point2D[];
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  depthParallaxScore: number;
  quality: FaceQualityMetrics;
  allPoints: Point2D[];
  guidance: FacePositionGuidance;
}

export interface ExtractedFaceDescriptor {
  descriptor: number[];
  modelId: RecognitionModelId;
  confidence: number;
  faceCount: number;
}

// MediaPipe 478-point indices for 6-point EAR eye contours
const MP_LEFT_EYE_EAR_INDICES = [263, 387, 385, 362, 380, 373];
const MP_RIGHT_EYE_EAR_INDICES = [33, 160, 158, 133, 153, 144];

// Key contour subset for clean minimal landmark overlay
const MP_CONTOUR_SUBSET_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
  1, 2, 98, 327, 168, 6, 197, 195, 5, 4,
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
];

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function trackFaceWithLandmarker(
  videoEl: HTMLVideoElement,
  timestampMs: number,
  luminanceScore: number,
  scratchCanvas: HTMLCanvasElement
): TrackedFaceFrame | null {
  if (videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    return null;
  }

  const landmarker = getFaceLandmarker();
  if (!landmarker) {
    return null;
  }

  const result = landmarker.detectForVideo(videoEl, timestampMs);
  const faceCount = result.faceLandmarks?.length || 0;
  if (faceCount === 0) {
    return null;
  }

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const landmarks = result.faceLandmarks[0];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of landmarks) {
    const px = pt.x * vw;
    const py = pt.y * vh;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const box = {
    x: clamp(minX, 0, vw),
    y: clamp(minY, 0, vh),
    width: clamp(Math.max(1, maxX - minX), 1, vw),
    height: clamp(Math.max(1, maxY - minY), 1, vh),
  };

  const toPoint = (idx: number): Point2D => {
    const pt = landmarks[idx];
    return { x: pt.x * vw, y: pt.y * vh };
  };

  const avgPoints = (indices: number[]): Point2D => {
    let sx = 0;
    let sy = 0;
    for (const idx of indices) {
      sx += landmarks[idx].x * vw;
      sy += landmarks[idx].y * vh;
    }
    return { x: sx / indices.length, y: sy / indices.length };
  };

  const leftEyePoints = MP_LEFT_EYE_EAR_INDICES.map(toPoint);
  const rightEyePoints = MP_RIGHT_EYE_EAR_INDICES.map(toPoint);
  const allPoints = MP_CONTOUR_SUBSET_INDICES.map(toPoint);

  const subjectRightEyeCenter = avgPoints([33, 133, 159, 145]);
  const subjectLeftEyeCenter = avgPoints([362, 263, 386, 374]);
  const noseTip = toPoint(1);
  const subjectRightMouth = toPoint(61);
  const subjectLeftMouth = toPoint(291);
  const alignmentFivePoints: Point2D[] = [
    subjectRightEyeCenter,
    subjectLeftEyeCenter,
    noseTip,
    subjectRightMouth,
    subjectLeftMouth,
  ];

  let eyeBlinkLeft = 0;
  let eyeBlinkRight = 0;
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (categories) {
    for (const cat of categories) {
      if (cat.categoryName === 'eyeBlinkLeft') eyeBlinkLeft = cat.score;
      else if (cat.categoryName === 'eyeBlinkRight') eyeBlinkRight = cat.score;
    }
  }

  const depthParallaxScore = computeDepthParallaxScore(landmarks);
  const sharpnessScore = computeFaceSharpness(videoEl, box, scratchCanvas);
  const quality = evaluateFaceQuality({
    landmarks,
    fivePointsPx: alignmentFivePoints,
    boxPx: box,
    vw,
    vh,
    luminanceScore,
    sharpnessScore,
  });

  if (faceCount > 1) {
    return {
      faceCount,
      confidence: 0.95,
      box,
      leftEyePoints,
      rightEyePoints,
      alignmentFivePoints,
      eyeBlinkLeft,
      eyeBlinkRight,
      depthParallaxScore,
      quality: {
        ...quality,
        passed: false,
        failureReason: 'Multiple faces detected.',
      },
      allPoints,
      guidance: {
        faceCount,
        singleFaceOk: false,
        centeredOk: false,
        sizeOk: false,
        lightingOk: luminanceScore >= 26,
        guidanceMessage: 'Multiple faces detected.',
      },
    };
  }

  const centerXRatio = (box.x + box.width / 2) / vw;
  const centerYRatio = (box.y + box.height / 2) / vh;
  const areaRatio = (box.width * box.height) / (vw * vh);

  const centeredOk =
    centerXRatio >= 0.10 &&
    centerXRatio <= 0.90 &&
    centerYRatio >= 0.08 &&
    centerYRatio <= 0.92;
  const sizeOk = areaRatio >= 0.02 && areaRatio <= 0.92;
  const lightingOk = luminanceScore >= 18 && luminanceScore <= 248;

  return {
    faceCount: 1,
    confidence: 0.96,
    box,
    leftEyePoints,
    rightEyePoints,
    alignmentFivePoints,
    eyeBlinkLeft,
    eyeBlinkRight,
    depthParallaxScore,
    quality,
    allPoints,
    guidance: {
      faceCount: 1,
      singleFaceOk: true,
      centeredOk,
      sizeOk,
      lightingOk,
      guidanceMessage: quality.failureReason || 'Face detected.',
    },
  };
}

let captureCanvasSingleton: HTMLCanvasElement | null = null;

/**
 * Captures an unmirrored JPEG snapshot of the live video stream (max dim 560px)
 * so the backend SCRFD + ArcFace ONNX pipeline sees full face quality AND detects bystanders.
 */
export function captureEvidenceFrameJpeg(
  videoEl: HTMLVideoElement,
  maxDimension = 560,
  jpegQuality = 0.86
): string | null {
  if (videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    return null;
  }

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const scale = Math.min(1, maxDimension / Math.max(vw, vh));
  const targetW = Math.max(120, Math.round(vw * scale));
  const targetH = Math.max(120, Math.round(vh * scale));

  if (!captureCanvasSingleton) {
    captureCanvasSingleton = document.createElement('canvas');
  }
  captureCanvasSingleton.width = targetW;
  captureCanvasSingleton.height = targetH;

  const ctx = captureCanvasSingleton.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(videoEl, 0, 0, targetW, targetH);
  return captureCanvasSingleton.toDataURL('image/jpeg', jpegQuality);
}
