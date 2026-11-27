import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { api, verificationApi } from '../api/client.ts';
import {
  BlinkLivenessTracker,
  Point2D,
  QUALITY_THRESHOLDS,
  TrackedFaceFrame,
  areFaceModelsLoaded,
  captureEvidenceFrameJpeg,
  loadPretrainedFaceModels,
  measureFrameLuminance,
  startFrontCamera,
  stopCameraStream,
  trackFaceWithLandmarker,
} from '../facial-verification/index.ts';
import {
  LivenessChallengeType,
  VerificationEvidenceFrames,
  VerificationResult,
} from '../shared/types.ts';

export interface FacialVerificationProps {
  /** Student / subject display ID from authenticated parent VTU Smart Attendance app */
  studentId?: string;
  /** Unique single-use verification session ID issued by POST /api/verification/session */
  verificationSessionId: string;
  /** Server-signed HMAC token from POST /api/verification/session (required for live verification) */
  sessionToken?: string;
  /** Parent QR attendance session identifier */
  qrSessionId?: string;
  /** Server-randomized liveness challenge bound to sessionToken */
  challengeType?: LivenessChallengeType;
  /** Server-supplied prompt instruction for the randomized challenge */
  challengeInstruction?: string;
  /** Optional backend base URL (defaults to same origin) */
  apiBaseUrl?: string;
  /** Controls visibility; camera starts automatically when true and stops on false */
  isOpen?: boolean;
  /** Called immediately once verification succeeds or fails; camera is stopped beforehand */
  onComplete: (result: VerificationResult) => void;
  /** Optional cancel callback */
  onCancel?: () => void;
}

type VerifierUiState =
  | { phase: 'initializing'; message: string }
  | { phase: 'position'; message: string }
  | { phase: 'detected'; message: string }
  | { phase: 'blink'; message: string }
  | { phase: 'verifying'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'failure'; message: string };

interface TrackedOvalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CHALLENGE_TIMEOUT_MS = 22000;
const TRACKING_INTERVAL_MS = 33; // ~30 FPS real-time MediaPipe tracking
const DEFAULT_THRESHOLD = 0.4;
const ACTIVE_MODEL_ID = 'arcface-w600k-mbf-512d' as const;
const ACTIVE_MODEL_VERSION = 'insightface-buffalo_sc-w600k_mbf-v1';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function mapVideoPointToContainer(
  pt: Point2D,
  vw: number,
  vh: number,
  cw: number,
  ch: number
): Point2D {
  const scale = Math.min(cw / vw, ch / vh);
  const renderedW = vw * scale;
  const renderedH = vh * scale;
  const offsetX = (cw - renderedW) / 2;
  const offsetY = (ch - renderedH) / 2;
  return {
    // Horizontally mirrored to accurately track CSS -scale-x-100 front camera
    x: offsetX + (vw - pt.x) * scale,
    y: offsetY + pt.y * scale,
  };
}

export const FacialVerification: React.FC<FacialVerificationProps> = ({
  studentId = '',
  verificationSessionId,
  sessionToken,
  qrSessionId = '',
  challengeType = 'BLINK_AND_HEAD_LEFT',
  apiBaseUrl = '',
  isOpen = true,
  onComplete,
  onCancel,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const lastMpTimestampRef = useRef<number>(0);
  const blinkTrackerRef = useRef<BlinkLivenessTracker>(new BlinkLivenessTracker());
  const finishedRef = useRef<boolean>(false);
  const multiFaceCountRef = useRef<number>(0);
  const challengeStartedAtRef = useRef<number | null>(null);

  const capturedFramesRef = useRef<Partial<VerificationEvidenceFrames>>({});
  const smoothedRectRef = useRef<TrackedOvalRect | null>(null);
  const identityCheckedRef = useRef<boolean>(false);
  const identityCheckingRef = useRef<boolean>(false);
  const identifyAttemptsRef = useRef<number>(0);
  const isInferringRef = useRef<boolean>(false);
  const [isPortraitVideo, setIsPortraitVideo] = useState<boolean>(false);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [trackedOval, setTrackedOval] = useState<TrackedOvalRect | null>(null);

  const latestPropsRef = useRef({
    studentId,
    verificationSessionId,
    sessionToken,
    qrSessionId,
    challengeType,
    apiBaseUrl,
    onComplete,
  });
  latestPropsRef.current = {
    studentId,
    verificationSessionId,
    sessionToken,
    qrSessionId,
    challengeType,
    apiBaseUrl,
    onComplete,
  };

  const [uiState, setUiState] = useState<VerifierUiState>({
    phase: 'initializing',
    message: 'Position your face inside the frame.',
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      setViewportSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const drawLandmarks = useCallback((detected: TrackedFaceFrame | null) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = viewport.clientWidth;
    const ch = viewport.clientHeight;
    if (!cw || !ch) return;

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    ctx.clearRect(0, 0, cw, ch);

    if (!detected || !video || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(cw / vw, ch / vh);
    const renderedW = vw * scale;
    const renderedH = vh * scale;
    const offsetX = (cw - renderedW) / 2;
    const offsetY = (ch - renderedH) / 2;

    // Horizontally mirrored bounding box (matching CSS -scale-x-100 video)
    const boxLeft = offsetX + (vw - (detected.box.x + detected.box.width)) * scale;
    const boxTop = offsetY + detected.box.y * scale;
    const boxWidth = detected.box.width * scale;
    const boxHeight = detected.box.height * scale;

    const isGoodQuality = detected.quality?.passed ?? false;
    const primaryColor = isGoodQuality ? '#10B981' : '#DF6A24';

    // 1. Draw corner brackets around the detected face
    const cornerLength = Math.min(22, boxWidth * 0.25, boxHeight * 0.25);
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(boxLeft, boxTop + cornerLength);
    ctx.lineTo(boxLeft, boxTop);
    ctx.lineTo(boxLeft + cornerLength, boxTop);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(boxLeft + boxWidth - cornerLength, boxTop);
    ctx.lineTo(boxLeft + boxWidth, boxTop);
    ctx.lineTo(boxLeft + boxWidth, boxTop + cornerLength);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(boxLeft, boxTop + boxHeight - cornerLength);
    ctx.lineTo(boxLeft, boxTop + boxHeight);
    ctx.lineTo(boxLeft + cornerLength, boxTop + boxHeight);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(boxLeft + boxWidth - cornerLength, boxTop + boxHeight);
    ctx.lineTo(boxLeft + boxWidth, boxTop + boxHeight);
    ctx.lineTo(boxLeft + boxWidth, boxTop + boxHeight - cornerLength);
    ctx.stroke();

    // Subtle dashed bounding box outline
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isGoodQuality ? 'rgba(16, 185, 129, 0.4)' : 'rgba(223, 106, 36, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.setLineDash([]);

    // 2. Confidence tag above bounding box
    const tagText = isGoodQuality ? 'FACE ALIGNED' : 'FACE DETECTED';
    ctx.font = '600 11px system-ui, sans-serif';
    const textWidth = ctx.measureText(tagText).width;
    const badgePadding = 6;
    const badgeHeight = 18;
    const badgeX = Math.max(8, boxLeft);
    const badgeY = Math.max(badgeHeight + 2, boxTop - 6);

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY - badgeHeight, textWidth + badgePadding * 2, badgeHeight, 4);
    } else {
      ctx.rect(badgeX, badgeY - badgeHeight, textWidth + badgePadding * 2, badgeHeight);
    }
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(tagText, badgeX + badgePadding, badgeY - 5);

    // 3. Draw accurate landmark dots on the face
    const pointsToDraw = detected.contourPoints && detected.contourPoints.length > 0
      ? detected.contourPoints
      : detected.allPoints.slice(0, 60);

    ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
    for (const pt of pointsToDraw) {
      const mapped = mapVideoPointToContainer(pt, vw, vh, cw, ch);
      ctx.beginPath();
      ctx.arc(mapped.x, mapped.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Five key alignment anchor points (eyes, nose, mouth)
    if (detected.alignmentFivePoints) {
      for (const pt of detected.alignmentFivePoints) {
        const mapped = mapVideoPointToContainer(pt, vw, vh, cw, ch);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(mapped.x, mapped.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 5. Eye outlines
    const drawEye = (pts: Point2D[]) => {
      if (pts.length < 6) return;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const first = mapVideoPointToContainer(pts[0], vw, vh, cw, ch);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pts.length; i++) {
        const mapped = mapVideoPointToContainer(pts[i], vw, vh, cw, ch);
        ctx.lineTo(mapped.x, mapped.y);
      }
      ctx.closePath();
      ctx.stroke();
    };
    drawEye(detected.leftEyePoints);
    drawEye(detected.rightEyePoints);
  }, []);

  const updateTrackedOvalFromFace = useCallback((detected: TrackedFaceFrame | null) => {
    const video = videoRef.current;
    const viewport = viewportRef.current;
    if (!detected || !video || !video.videoWidth || !video.videoHeight || !viewport) {
      smoothedRectRef.current = null;
      setTrackedOval(null);
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = viewport.clientWidth;
    const ch = viewport.clientHeight;
    if (!cw || !ch) return;

    const scale = Math.min(cw / vw, ch / vh);
    const center = mapVideoPointToContainer(
      {
        x: detected.box.x + detected.box.width / 2,
        y: detected.box.y + detected.box.height / 2,
      },
      vw,
      vh,
      cw,
      ch
    );

    const rawHeight = Math.max(
      detected.box.height * scale * 1.45,
      detected.box.width * scale * 1.65
    );
    const height = clamp(rawHeight, Math.min(ch * 0.45, 180), ch * 0.82);
    const width = clamp(height * 0.74, 140, cw * 0.82);

    const targetLeft = clamp(center.x - width / 2, 8, Math.max(8, cw - width - 8));
    const targetTop = clamp(center.y - height / 2, 8, Math.max(8, ch - height - 8));

    const prev = smoothedRectRef.current;
    const alpha = 0.65; // Highly responsive tracking without lag
    const next: TrackedOvalRect = prev
      ? {
          left: prev.left + (targetLeft - prev.left) * alpha,
          top: prev.top + (targetTop - prev.top) * alpha,
          width: prev.width + (width - prev.width) * alpha,
          height: prev.height + (height - prev.height) * alpha,
        }
      : {
          left: targetLeft,
          top: targetTop,
          width,
          height,
        };

    smoothedRectRef.current = next;
    setTrackedOval(next);
  }, []);

  const stopCameraImmediately = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopCameraStream(streamRef.current, videoRef.current);
    streamRef.current = null;
    smoothedRectRef.current = null;
    setTrackedOval(null);
    drawLandmarks(null);
  }, [drawLandmarks]);

  const dispatchResult = useCallback((result: VerificationResult) => {
    latestPropsRef.current.onComplete(result);
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'VTU_FACIAL_VERIFICATION_RESULT', result }, '*');
      }
    } catch {
      // Ignore cross-origin frame restrictions
    }
  }, []);

  const emitFailure = useCallback(
    (failureReason: string, faceDetected = false, livenessVerified = false) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      stopCameraImmediately();
      setUiState({ phase: 'failure', message: failureReason });

      const {
        studentId: stuId,
        verificationSessionId: sessId,
        qrSessionId: qrId,
        challengeType: chType,
      } = latestPropsRef.current;

      dispatchResult({
        studentId: stuId,
        qrSessionId: qrId,
        verificationSessionId: sessId,
        challengeType: chType,
        faceDetected,
        faceMatch: 'NO_MATCH',
        blinkDetected: livenessVerified,
        livenessVerified,
        verificationStatus: 'FAILED',
        modelId: ACTIVE_MODEL_ID,
        modelVersion: ACTIVE_MODEL_VERSION,
        confidenceScore: null,
        euclideanDistance: null,
        cosineSimilarity: null,
        thresholdUsed: DEFAULT_THRESHOLD,
        failureReason,
        verifiedAt: new Date().toISOString(),
        resultSignature: '',
      });
    },
    [dispatchResult, stopCameraImmediately]
  );

  const submitCapturedEvidence = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const video = videoRef.current;
    const frames = capturedFramesRef.current;
    if (video && !frames.postChallengeOpenJpeg) {
      const snap = captureEvidenceFrameJpeg(video);
      if (snap) frames.postChallengeOpenJpeg = snap;
    }

    stopCameraImmediately();
    setUiState({ phase: 'verifying', message: 'Verifying identity...' });

    const {
      studentId: stuId,
      verificationSessionId: sessId,
      sessionToken: token,
      qrSessionId: qrId,
      challengeType: chType,
      apiBaseUrl: baseUrl,
    } = latestPropsRef.current;

    if (!token) {
      const msg = 'Signed VTU verification session token is required from the parent application.';
      setUiState({ phase: 'failure', message: msg });
      dispatchResult({
        studentId: stuId,
        qrSessionId: qrId,
        verificationSessionId: sessId,
        challengeType: chType,
        faceDetected: true,
        faceMatch: 'NO_MATCH',
        blinkDetected: true,
        livenessVerified: true,
        verificationStatus: 'FAILED',
        modelId: ACTIVE_MODEL_ID,
        modelVersion: ACTIVE_MODEL_VERSION,
        confidenceScore: null,
        euclideanDistance: null,
        cosineSimilarity: null,
        thresholdUsed: DEFAULT_THRESHOLD,
        failureReason: msg,
        verifiedAt: new Date().toISOString(),
        resultSignature: '',
      });
      return;
    }

    if (
      !frames.baselineOpenJpeg ||
      !frames.blinkClosedJpeg ||
      !frames.challengeActionJpeg ||
      !frames.postChallengeOpenJpeg
    ) {
      const msg = 'Incomplete liveness evidence frames captured.';
      setUiState({ phase: 'failure', message: msg });
      dispatchResult({
        studentId: stuId,
        qrSessionId: qrId,
        verificationSessionId: sessId,
        challengeType: chType,
        faceDetected: true,
        faceMatch: 'NO_MATCH',
        blinkDetected: false,
        livenessVerified: false,
        verificationStatus: 'FAILED',
        modelId: ACTIVE_MODEL_ID,
        modelVersion: ACTIVE_MODEL_VERSION,
        confidenceScore: null,
        euclideanDistance: null,
        cosineSimilarity: null,
        thresholdUsed: DEFAULT_THRESHOLD,
        failureReason: msg,
        verifiedAt: new Date().toISOString(),
        resultSignature: '',
      });
      return;
    }

    try {
      let result: VerificationResult;
      if (qrId) {
        try {
          const fin = await api.finalizeFaceAttendance(
            {
              verificationSessionId: sessId,
              sessionToken: token,
              qrSessionId: qrId,
              evidenceFrames: frames as VerificationEvidenceFrames,
            },
            baseUrl
          );
          result = {
            ...fin.verificationResult,
            record: fin.record,
            attempt: fin.attempt,
            latencyBreakdown: fin.latencyMetrics,
          };
        } catch (finErr: any) {
          result = {
            studentId: stuId,
            qrSessionId: qrId,
            verificationSessionId: sessId,
            challengeType: chType,
            faceDetected: true,
            faceMatch: 'NO_MATCH',
            blinkDetected: false,
            livenessVerified: false,
            verificationStatus: 'FAILED',
            modelId: ACTIVE_MODEL_ID,
            modelVersion: ACTIVE_MODEL_VERSION,
            confidenceScore: null,
            euclideanDistance: null,
            cosineSimilarity: null,
            thresholdUsed: DEFAULT_THRESHOLD,
            failureReason: finErr instanceof Error ? finErr.message : String(finErr || 'Attendance verification failed.'),
            verifiedAt: new Date().toISOString(),
            resultSignature: '',
          };
        }
      } else {
        result = await verificationApi.verifyFace(
          {
            verificationSessionId: sessId,
            sessionToken: token,
            qrSessionId: qrId || undefined,
            evidenceFrames: frames as VerificationEvidenceFrames,
          },
          baseUrl
        );
      }

      if (result.verificationStatus === 'VERIFIED') {
        const latStr = result.latencyBreakdown
          ? ` (Face Det: ${result.latencyBreakdown.detectionMs}ms, ArcFace: ${result.latencyBreakdown.embeddingMs}ms, Backend: ${result.latencyBreakdown.verificationMs}ms, Total: ${result.latencyBreakdown.totalMs}ms)`
          : '';
        console.log(`[VTU Facial Verification] Success! Attendance verified for ${result.studentId}${latStr}`);
        setUiState({ phase: 'success', message: 'Identity & attendance verified successfully.' });
      } else {
        setUiState({
          phase: 'failure',
          message: result.failureReason || 'Verification failed.',
        });
      }
      dispatchResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Server verification failed.';
      setUiState({ phase: 'failure', message: msg });
      dispatchResult({
        studentId: stuId,
        qrSessionId: qrId,
        verificationSessionId: sessId,
        challengeType: chType,
        faceDetected: true,
        faceMatch: 'NO_MATCH',
        blinkDetected: false,
        livenessVerified: false,
        verificationStatus: 'FAILED',
        modelId: ACTIVE_MODEL_ID,
        modelVersion: ACTIVE_MODEL_VERSION,
        confidenceScore: null,
        euclideanDistance: null,
        cosineSimilarity: null,
        thresholdUsed: DEFAULT_THRESHOLD,
        failureReason: msg,
        verifiedAt: new Date().toISOString(),
        resultSignature: '',
      });
    }
  }, [dispatchResult, stopCameraImmediately]);

  useEffect(() => {
    if (!isOpen) {
      stopCameraImmediately();
      return;
    }

    let cancelled = false;
    finishedRef.current = false;
    identityCheckedRef.current = false;
    identityCheckingRef.current = false;
    identifyAttemptsRef.current = 0;
    multiFaceCountRef.current = 0;
    challengeStartedAtRef.current = null;
    capturedFramesRef.current = {};
    lastFrameTimeRef.current = 0;
    lastMpTimestampRef.current = 0;
    blinkTrackerRef.current.reset(latestPropsRef.current.challengeType);

    const isModelsReady = areFaceModelsLoaded();
    setUiState({
      phase: 'initializing',
      message: isModelsReady
        ? 'Starting front camera...'
        : 'Starting camera & initializing facial recognition...',
    });

    (async () => {
      try {
        if (!videoRef.current) return;

        const [started] = await Promise.all([
          startFrontCamera(videoRef.current),
          loadPretrainedFaceModels('/models'),
        ]);

        if (cancelled) {
          stopCameraStream(started.stream, videoRef.current);
          return;
        }
        streamRef.current = started.stream;
        if (started.height > started.width) {
          setIsPortraitVideo(true);
        }
        setUiState({ phase: 'position', message: 'Position your face inside the frame.' });

        if (!scratchCanvasRef.current) {
          scratchCanvasRef.current = document.createElement('canvas');
        }

        const runFrame = async (rafNow: number) => {
          if (cancelled || finishedRef.current) return;

          if (rafNow - lastFrameTimeRef.current >= TRACKING_INTERVAL_MS) {
            // Guard against overlapping inference loops on fast 90/120Hz mobile displays
            if (isInferringRef.current) {
              if (!cancelled && !finishedRef.current) {
                rafRef.current = window.requestAnimationFrame(runFrame);
              }
              return;
            }

            lastFrameTimeRef.current = rafNow;
            const video = videoRef.current;
            const scratch = scratchCanvasRef.current;

            if (video && scratch && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
              isInferringRef.current = true;
              try {
                const mpTimestamp = Math.max(
                  Math.round(rafNow),
                  lastMpTimestampRef.current + 1
                );
                lastMpTimestampRef.current = mpTimestamp;

                const lum = measureFrameLuminance(video, scratch);
                const detected = trackFaceWithLandmarker(video, mpTimestamp, lum, scratch);

                drawLandmarks(detected);
                updateTrackedOvalFromFace(detected);

                if (!detected) {
                  multiFaceCountRef.current = 0;
                  setUiState({
                    phase: 'position',
                    message: 'Position your face inside the frame.',
                  });
                } else if (detected.faceCount > 1) {
                  multiFaceCountRef.current += 1;
                  if (multiFaceCountRef.current >= 4) {
                    emitFailure('Multiple faces detected.', true);
                    return;
                  }
                } else {
                  multiFaceCountRef.current = 0;

                  // Check spatial positioning, lighting, sharpness without blocking intentional head turns
                  const spatialQualityOk =
                    detected.guidance.centeredOk &&
                    detected.guidance.sizeOk &&
                    detected.quality.withinBounds &&
                    detected.quality.sharpnessScore >= QUALITY_THRESHOLDS.minSharpnessVariance &&
                    detected.quality.luminanceScore >= QUALITY_THRESHOLDS.minLuminance &&
                    detected.quality.luminanceScore <= QUALITY_THRESHOLDS.maxLuminance;

                  if (!spatialQualityOk) {
                    setUiState({
                      phase: 'position',
                      message: detected.quality.failureReason || 'Position your face inside the frame.',
                    });
                  } else if (!identityCheckedRef.current) {
                    // Step 1: Check facial identity against registered enrolled references
                    if (!identityCheckingRef.current && video) {
                      identityCheckingRef.current = true;
                      setUiState({
                        phase: 'verifying',
                        message: 'Scanning face against enrolled references...',
                      });
                      const snapJpeg = captureEvidenceFrameJpeg(video);
                      if (snapJpeg) {
                        capturedFramesRef.current.baselineOpenJpeg = snapJpeg;
                        const {
                          verificationSessionId: sessId,
                          sessionToken: tok,
                          apiBaseUrl: bUrl,
                        } = latestPropsRef.current;
                        verificationApi
                          .identifyFace(
                            {
                              verificationSessionId: sessId,
                              sessionToken: tok || '',
                              liveFrameJpeg: snapJpeg,
                            },
                            bUrl
                          )
                          .then((identRes) => {
                            if (finishedRef.current) return;
                            if (identRes.isProxy) {
                              emitFailure(
                                identRes.message ||
                                  'Proxy attempt rejected: Face does not match registered student.',
                                true,
                                false
                              );
                            } else if (identRes.matched) {
                              identityCheckedRef.current = true;
                              identityCheckingRef.current = false;
                              setUiState({
                                phase: 'blink',
                                message: `Identity Confirmed: ${identRes.studentName} (${identRes.matchedUsn}). Please blink naturally.`,
                              });
                            } else if (identRes.status === 'NO_USER_FOUND') {
                              // Verified by ArcFace against all enrolled students, no match found
                              identifyAttemptsRef.current += 1;
                              if (identifyAttemptsRef.current >= 4) {
                                emitFailure(
                                  identRes.message || 'No User Found: Face did not match enrolled student reference.',
                                  true,
                                  false
                                );
                              } else {
                                setUiState({
                                  phase: 'position',
                                  message: `${identRes.message || 'No User Found'} (${identifyAttemptsRef.current}/3)`,
                                });
                                setTimeout(() => {
                                  identityCheckingRef.current = false;
                                }, 800);
                              }
                            } else {
                              // Temporary frame positioning/quality feedback (e.g. POOR_QUALITY, NO_FACE)
                              setUiState({
                                phase: 'position',
                                message: identRes.message || 'Align face clearly inside frame...',
                              });
                              setTimeout(() => {
                                identityCheckingRef.current = false;
                              }, 600);
                            }
                          })
                          .catch((err) => {
                            console.warn('[VTU Verification] identifyFace network or server error:', err);
                            setUiState({
                              phase: 'position',
                              message: 'Connecting to face recognition service...',
                            });
                            setTimeout(() => {
                              identityCheckingRef.current = false;
                            }, 800);
                          });
                      } else {
                        identityCheckingRef.current = false;
                      }
                    }
                  } else {
                    // Step 2: Facial identity confirmed! Proceed to natural blink / liveness verification
                    blinkTrackerRef.current.setChallengeType(latestPropsRef.current.challengeType);

                    const snap = blinkTrackerRef.current.processFrame(
                      detected.leftEyePoints,
                      detected.rightEyePoints,
                      detected.allPoints,
                      Date.now(),
                      {
                        eyeBlinkLeft: detected.eyeBlinkLeft,
                        eyeBlinkRight: detected.eyeBlinkRight,
                        depthParallaxScore: detected.depthParallaxScore,
                        yawDeg: detected.quality.yawDeg,
                        pitchDeg: detected.quality.pitchDeg,
                      }
                    );

                    // Enforce time-limited challenge once face enters calibration/liveness
                    if (!challengeStartedAtRef.current) {
                      challengeStartedAtRef.current = Date.now();
                    } else if (Date.now() - challengeStartedAtRef.current > CHALLENGE_TIMEOUT_MS) {
                      emitFailure('Verification challenge timed out.', true);
                      return;
                    }

                    // Capture requested evidence JPEG at exact challenge milestones
                    if (snap.captureRoleNeeded) {
                      const jpegStr = captureEvidenceFrameJpeg(video);
                      if (jpegStr) {
                        capturedFramesRef.current[snap.captureRoleNeeded] = jpegStr;
                        blinkTrackerRef.current.markCaptured(snap.captureRoleNeeded);
                      }
                    }

                    if (snap.challengePhase === 'CALIBRATING') {
                      if (!detected.quality.passed) {
                        setUiState({
                          phase: 'position',
                          message: detected.quality.failureReason || 'Look straight at the camera.',
                        });
                      } else {
                        setUiState({ phase: 'detected', message: snap.instruction });
                      }
                    } else if (
                      snap.challengePhase === 'AWAIT_BLINK' ||
                      snap.challengePhase === 'AWAIT_HEAD_ACTION' ||
                      snap.challengePhase === 'AWAIT_RETURN_FRONTAL'
                    ) {
                      setUiState({ phase: 'blink', message: snap.instruction });
                    } else if (snap.challengePhase === 'FAILED') {
                      emitFailure('Liveness challenge failed.', true);
                      return;
                    } else if (snap.challengePhase === 'COMPLETED') {
                      await submitCapturedEvidence();
                      return;
                    }
                  }
                }
              } catch (frameErr) {
                console.warn('[VTU Verification] runFrame error:', frameErr);
              } finally {
                isInferringRef.current = false;
              }
            }
          }

          if (!cancelled && !finishedRef.current) {
            rafRef.current = window.requestAnimationFrame(runFrame);
          }
        };

        rafRef.current = window.requestAnimationFrame(runFrame);
      } catch (err) {
        if (!cancelled) {
          emitFailure(
            err instanceof Error ? err.message : 'Unable to access front camera.',
            false
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCameraImmediately();
    };
  }, [
    drawLandmarks,
    emitFailure,
    isOpen,
    stopCameraImmediately,
    submitCapturedEvidence,
    updateTrackedOvalFromFace,
  ]);

  if (!isOpen) return null;

  const outlineColor =
    uiState.phase === 'success'
      ? 'border-[#165B33]'
      : uiState.phase === 'failure'
        ? 'border-[#B42318]'
        : uiState.phase === 'blink' || uiState.phase === 'detected'
          ? 'border-[#DF6A24]'
          : 'border-white/80';

  const cw = viewportSize.width || 480;
  const ch = viewportSize.height || 360;
  const defaultOvalHeight = clamp(ch * 0.72, 200, Math.max(200, ch - 30));
  const defaultOvalWidth = clamp(defaultOvalHeight * 0.72, 145, Math.max(145, cw * 0.75));

  const activeOval: TrackedOvalRect = trackedOval ?? {
    left: (cw - defaultOvalWidth) / 2,
    top: (ch - defaultOvalHeight) / 2,
    width: defaultOvalWidth,
    height: defaultOvalHeight,
  };

  return (
    <div className="w-full max-w-xl mx-auto flex flex-col rounded-md border border-[#E3D2B4] bg-[#FFFDF8] overflow-hidden shadow-sm">
      {/* Natural Camera Field of View (Responsive portrait/landscape framing, 1:1 landmark alignment) */}
      <div
        ref={viewportRef}
        className={`relative w-full ${
          isPortraitVideo ? 'aspect-[3/4] max-h-[68vh]' : 'aspect-[4/3] sm:aspect-[16/10]'
        } bg-[#1a120c] overflow-hidden flex items-center justify-center`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain -scale-x-100 ${
            uiState.phase === 'success' || uiState.phase === 'failure'
              ? 'opacity-30'
              : 'opacity-100'
          }`}
        />

        <canvas
          ref={overlayCanvasRef}
          data-testid="face-overlay-canvas"
          className="pointer-events-none absolute inset-0 w-full h-full"
        />

        <div
          style={{
            left: `${activeOval.left}px`,
            top: `${activeOval.top}px`,
            width: `${activeOval.width}px`,
            height: `${activeOval.height}px`,
          }}
          className={`pointer-events-none absolute rounded-[999px] border-[2.5px] ${
            trackedOval ? 'border-solid' : 'border-dashed'
          } ${outlineColor} transition-[left,top,width,height,border-color] duration-75 ease-out`}
        />

        {onCancel && (
          <button
            type="button"
            aria-label="Cancel verification"
            onClick={() => {
              stopCameraImmediately();
              onCancel();
            }}
            className="absolute top-3 right-3 rounded-full bg-[#241710]/70 p-2 text-white hover:bg-[#241710]"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Minimal Status Line */}
      <div className="px-4 py-3 border-t border-[#E3D2B4] bg-[#FFFDF8] flex items-center justify-center gap-2 text-center shrink-0">
        {uiState.phase === 'success' && (
          <CheckCircle2 className="w-4 h-4 text-[#165B33] shrink-0" />
        )}
        {uiState.phase === 'failure' && (
          <XCircle className="w-4 h-4 text-[#B42318] shrink-0" />
        )}
        <span
          data-testid="face-status-text"
          className={`text-sm font-medium ${
            uiState.phase === 'success'
              ? 'text-[#165B33]'
              : uiState.phase === 'failure'
                ? 'text-[#B42318]'
                : uiState.phase === 'blink'
                  ? 'text-[#DF6A24]'
                  : 'text-[#241710]'
          }`}
        >
          {uiState.message}
        </span>
      </div>
    </div>
  );
};
