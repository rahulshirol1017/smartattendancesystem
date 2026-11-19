import {
  BlinkSequenceStage,
  LivenessChallengeType,
  LivenessTelemetry,
} from '../shared/types.ts';

/**
 * Multi-Signal Eye Blink + Randomized Head-Movement Liveness Tracker
 *
 * Enforces an ordered, time-limited sequence:
 *   1. Calibrate frontal open-eye baseline (captures baselineOpenJpeg)
 *   2. Detect full natural blink: eyes open -> eyes closed (captures blinkClosedJpeg) -> eyes open
 *   3. Execute randomized server-issued head challenge:
 *      - BLINK_AND_HEAD_LEFT
 *      - BLINK_AND_HEAD_RIGHT
 *      - BLINK_AND_NOD
 *      (captures challengeActionJpeg at movement peak)
 *   4. Return head straight toward camera with eyes open (captures postChallengeOpenJpeg)
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface BlendshapeEyeScores {
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  depthParallaxScore?: number;
  yawDeg?: number;
  pitchDeg?: number;
}

export type ChallengePhase =
  | 'CALIBRATING'
  | 'AWAIT_BLINK'
  | 'AWAIT_HEAD_ACTION'
  | 'AWAIT_RETURN_FRONTAL'
  | 'COMPLETED'
  | 'FAILED';

export interface BlinkFrameSnapshot {
  stage: BlinkSequenceStage;
  challengePhase: ChallengePhase;
  currentEar: number;
  leftEar: number;
  rightEar: number;
  baselineOpenEar: number;
  blinkDetected: boolean;
  motionVarianceScore: number;
  instruction: string;
  captureRoleNeeded:
    | 'baselineOpenJpeg'
    | 'blinkClosedJpeg'
    | 'challengeActionJpeg'
    | 'postChallengeOpenJpeg'
    | null;
  telemetry: LivenessTelemetry;
}

function euclidean2D(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function computeEyeAspectRatio(eyePoints: Point2D[]): number {
  if (eyePoints.length < 6) return 0;
  const p1 = eyePoints[0];
  const p2 = eyePoints[1];
  const p3 = eyePoints[2];
  const p4 = eyePoints[3];
  const p5 = eyePoints[4];
  const p6 = eyePoints[5];

  const verticalA = euclidean2D(p2, p6);
  const verticalB = euclidean2D(p3, p5);
  const horizontal = euclidean2D(p1, p4);

  if (horizontal <= 0.0001) return 0;
  return (verticalA + verticalB) / (2.0 * horizontal);
}

export class BlinkLivenessTracker {
  private stage: BlinkSequenceStage = 'WAITING_FACE';
  private challengePhase: ChallengePhase = 'CALIBRATING';
  private challengeType: LivenessChallengeType = 'BLINK_AND_HEAD_LEFT';
  private openCalibrationSamples: number[] = [];
  private yawSamples: number[] = [];
  private pitchSamples: number[] = [];
  private baselineOpenEar = 0;
  private baselineYawDeg = 0;
  private baselinePitchDeg = 0;
  private blinkCount = 0;
  private minEarObserved = 1;
  private maxEarObserved = 0;
  private openInitialAt?: number;
  private closedAt?: number;
  private challengeActionAt?: number;
  private reopenedAt?: number;
  private closedFrames = 0;
  private reopenedFrames = 0;
  private challengeFrames = 0;
  private frontalReturnFrames = 0;
  private baselineCaptured = false;
  private closedCaptured = false;
  private challengeCaptured = false;
  private postCaptured = false;
  private previousLandmarks: Point2D[] | null = null;
  private motionDeltas: number[] = [];
  private depthScores: number[] = [];
  private framesEvaluated = 0;

  public setChallengeType(type: LivenessChallengeType): void {
    this.challengeType = type;
  }

  public reset(challengeType?: LivenessChallengeType): void {
    if (challengeType) {
      this.challengeType = challengeType;
    }
    this.stage = 'WAITING_FACE';
    this.challengePhase = 'CALIBRATING';
    this.openCalibrationSamples = [];
    this.yawSamples = [];
    this.pitchSamples = [];
    this.baselineOpenEar = 0;
    this.baselineYawDeg = 0;
    this.baselinePitchDeg = 0;
    this.blinkCount = 0;
    this.minEarObserved = 1;
    this.maxEarObserved = 0;
    this.openInitialAt = undefined;
    this.closedAt = undefined;
    this.challengeActionAt = undefined;
    this.reopenedAt = undefined;
    this.closedFrames = 0;
    this.reopenedFrames = 0;
    this.challengeFrames = 0;
    this.frontalReturnFrames = 0;
    this.baselineCaptured = false;
    this.closedCaptured = false;
    this.challengeCaptured = false;
    this.postCaptured = false;
    this.previousLandmarks = null;
    this.motionDeltas = [];
    this.depthScores = [];
    this.framesEvaluated = 0;
  }

  public markCaptured(
    role:
      | 'baselineOpenJpeg'
      | 'blinkClosedJpeg'
      | 'challengeActionJpeg'
      | 'postChallengeOpenJpeg'
  ): void {
    if (role === 'baselineOpenJpeg') this.baselineCaptured = true;
    else if (role === 'blinkClosedJpeg') this.closedCaptured = true;
    else if (role === 'challengeActionJpeg') this.challengeCaptured = true;
    else if (role === 'postChallengeOpenJpeg') this.postCaptured = true;
  }

  public processFrame(
    leftEye: Point2D[],
    rightEye: Point2D[],
    allLandmarks: Point2D[],
    nowMs = Date.now(),
    signals?: BlendshapeEyeScores
  ): BlinkFrameSnapshot {
    this.framesEvaluated += 1;

    const leftEar = computeEyeAspectRatio(leftEye);
    const rightEar = computeEyeAspectRatio(rightEye);
    const rawEar = (leftEar + rightEar) / 2;

    const avgBlinkProb = signals ? (signals.eyeBlinkLeft + signals.eyeBlinkRight) / 2 : 0;
    const yawDeg = signals?.yawDeg ?? 0;
    const pitchDeg = signals?.pitchDeg ?? 0;

    if (typeof signals?.depthParallaxScore === 'number') {
      this.depthScores.push(signals.depthParallaxScore);
      if (this.depthScores.length > 50) this.depthScores.shift();
    }

    const effectiveEar = signals ? Math.max(0.05, rawEar * (1 - avgBlinkProb * 0.45)) : rawEar;
    if (effectiveEar < this.minEarObserved) this.minEarObserved = effectiveEar;
    if (effectiveEar > this.maxEarObserved) this.maxEarObserved = effectiveEar;

    if (this.previousLandmarks && this.previousLandmarks.length === allLandmarks.length) {
      let totalDisp = 0;
      for (let i = 0; i < allLandmarks.length; i++) {
        totalDisp += euclidean2D(allLandmarks[i], this.previousLandmarks[i]);
      }
      this.motionDeltas.push(totalDisp / allLandmarks.length);
      if (this.motionDeltas.length > 50) this.motionDeltas.shift();
    }
    this.previousLandmarks = allLandmarks.map((p) => ({ x: p.x, y: p.y }));

    const motionVarianceScore =
      this.motionDeltas.length > 0
        ? Number(
            (
              this.motionDeltas.reduce((acc, d) => acc + d, 0) / this.motionDeltas.length
            ).toFixed(3)
          )
        : 0;

    let captureRoleNeeded: BlinkFrameSnapshot['captureRoleNeeded'] = null;

    // 1. Calibrate frontal open-eye baseline
    if (this.challengePhase === 'CALIBRATING') {
      this.stage = 'CALIBRATING_OPEN';
      const eyesOpenByNeural = !signals || avgBlinkProb < 0.35;
      const frontalEnough = Math.abs(yawDeg) <= 18 && Math.abs(pitchDeg) <= 18;
      if (rawEar >= 0.18 && eyesOpenByNeural && frontalEnough) {
        this.openCalibrationSamples.push(effectiveEar);
        this.yawSamples.push(yawDeg);
        this.pitchSamples.push(pitchDeg);
      }

      if (this.openCalibrationSamples.length >= 3) {
        this.baselineOpenEar =
          this.openCalibrationSamples.reduce((a, b) => a + b, 0) /
          this.openCalibrationSamples.length;
        this.baselineYawDeg =
          this.yawSamples.reduce((a, b) => a + b, 0) / this.yawSamples.length;
        this.baselinePitchDeg =
          this.pitchSamples.reduce((a, b) => a + b, 0) / this.pitchSamples.length;
        this.stage = 'EYES_OPEN_READY';
        this.challengePhase = 'AWAIT_BLINK';
        this.openInitialAt = nowMs;
        if (!this.baselineCaptured) {
          captureRoleNeeded = 'baselineOpenJpeg';
        }
      }

      return this.snapshot(
        effectiveEar,
        leftEar,
        rightEar,
        motionVarianceScore,
        captureRoleNeeded
      );
    }

    const closedThreshold = Math.min(0.22, Math.max(0.155, this.baselineOpenEar * 0.74));
    const reopenThreshold = Math.max(0.2, this.baselineOpenEar * 0.84);

    // 2. Full eye blink: eyes open -> closed -> open
    if (this.challengePhase === 'AWAIT_BLINK') {
      if (!this.baselineCaptured && (!signals || avgBlinkProb < 0.3) && Math.abs(yawDeg) <= 18) {
        captureRoleNeeded = 'baselineOpenJpeg';
      }

      if (this.stage === 'EYES_OPEN_READY') {
        const closedByEar = effectiveEar <= closedThreshold;
        const closedByNeural = signals ? avgBlinkProb >= 0.45 : false;
        if (closedByEar || closedByNeural) {
          this.closedFrames += 1;
          if (this.closedFrames >= 1) {
            this.stage = 'EYES_CLOSED_DETECTED';
            this.closedAt = nowMs;
            this.reopenedFrames = 0;
            captureRoleNeeded = 'blinkClosedJpeg';
          }
        } else {
          this.closedFrames = 0;
        }
      } else if (this.stage === 'EYES_CLOSED_DETECTED') {
        if (!this.closedCaptured) {
          captureRoleNeeded = 'blinkClosedJpeg';
        }
        if (this.closedAt && nowMs - this.closedAt > 3200) {
          this.stage = 'FAILED';
          this.challengePhase = 'FAILED';
        } else {
          const openByEar = effectiveEar >= reopenThreshold;
          const openByNeural = !signals || avgBlinkProb <= 0.32;
          if (openByEar && openByNeural) {
            this.reopenedFrames += 1;
            if (this.reopenedFrames >= 2) {
              this.stage = 'BLINK_COMPLETED';
              this.blinkCount += 1;
              this.reopenedAt = nowMs;
              this.challengePhase = 'AWAIT_HEAD_ACTION';
            }
          } else {
            this.reopenedFrames = 0;
          }
        }
      }

      return this.snapshot(
        effectiveEar,
        leftEar,
        rightEar,
        motionVarianceScore,
        captureRoleNeeded
      );
    }

    // 3. Randomized head-movement challenge
    if (this.challengePhase === 'AWAIT_HEAD_ACTION') {
      const yawDelta = yawDeg - this.baselineYawDeg;
      const pitchDelta = pitchDeg - this.baselinePitchDeg;

      let matchedAction = false;
      if (this.challengeType === 'BLINK_AND_HEAD_LEFT') {
        matchedAction = yawDelta >= 9 || yawDeg >= 12;
      } else if (this.challengeType === 'BLINK_AND_HEAD_RIGHT') {
        matchedAction = yawDelta <= -9 || yawDeg <= -12;
      } else if (this.challengeType === 'BLINK_AND_NOD') {
        matchedAction = pitchDelta >= 6.5 || pitchDeg >= 9;
      }

      if (matchedAction) {
        this.challengeFrames += 1;
        if (!this.challengeCaptured) {
          captureRoleNeeded = 'challengeActionJpeg';
        }
        if (this.challengeFrames >= 2) {
          this.challengeActionAt = nowMs;
          this.challengePhase = 'AWAIT_RETURN_FRONTAL';
          this.frontalReturnFrames = 0;
        }
      } else {
        this.challengeFrames = 0;
      }

      return this.snapshot(
        effectiveEar,
        leftEar,
        rightEar,
        motionVarianceScore,
        captureRoleNeeded
      );
    }

    // 4. Return to frontal eyes-open gaze for final post-challenge identity check
    if (this.challengePhase === 'AWAIT_RETURN_FRONTAL') {
      const eyesOpen = (!signals || avgBlinkProb <= 0.32) && effectiveEar >= reopenThreshold;
      const isFrontal = Math.abs(yawDeg) <= 16 && Math.abs(pitchDeg) <= 16;

      if (eyesOpen && isFrontal) {
        this.frontalReturnFrames += 1;
        if (this.frontalReturnFrames >= 2) {
          if (!this.postCaptured) {
            captureRoleNeeded = 'postChallengeOpenJpeg';
          }
          this.challengePhase = 'COMPLETED';
        }
      } else {
        this.frontalReturnFrames = 0;
      }

      return this.snapshot(
        effectiveEar,
        leftEar,
        rightEar,
        motionVarianceScore,
        captureRoleNeeded
      );
    }

    return this.snapshot(
      effectiveEar,
      leftEar,
      rightEar,
      motionVarianceScore,
      null
    );
  }

  private getInstruction(): string {
    switch (this.challengePhase) {
      case 'CALIBRATING':
        return 'Look straight at the camera.';
      case 'AWAIT_BLINK':
        return 'Please blink once.';
      case 'AWAIT_HEAD_ACTION':
        if (this.challengeType === 'BLINK_AND_HEAD_LEFT') {
          return 'Blink detected. Slowly turn head left.';
        }
        if (this.challengeType === 'BLINK_AND_HEAD_RIGHT') {
          return 'Blink detected. Slowly turn head right.';
        }
        return 'Blink detected. Gently nod your head.';
      case 'AWAIT_RETURN_FRONTAL':
        return 'Look straight at the camera.';
      case 'COMPLETED':
        return 'Verifying identity...';
      case 'FAILED':
        return 'Liveness check failed.';
    }
  }

  private snapshot(
    currentEar: number,
    leftEar: number,
    rightEar: number,
    motionVarianceScore: number,
    captureRoleNeeded: BlinkFrameSnapshot['captureRoleNeeded']
  ): BlinkFrameSnapshot {
    const avgDepth =
      this.depthScores.length > 0
        ? Number(
            (
              this.depthScores.reduce((acc, s) => acc + s, 0) / this.depthScores.length
            ).toFixed(4)
          )
        : undefined;

    const telemetry: LivenessTelemetry = {
      blinkStage: this.stage,
      blinkDetected: this.blinkCount > 0,
      blinkCount: this.blinkCount,
      minEarObserved: Number(
        (this.minEarObserved === 1 ? currentEar : this.minEarObserved).toFixed(4)
      ),
      maxEarObserved: Number(this.maxEarObserved.toFixed(4)),
      avgOpenEar: Number(this.baselineOpenEar.toFixed(4)),
      motionVarianceScore,
      depthParallaxScore: avgDepth,
      challengeType: this.challengeType,
      challengeCompleted: this.challengePhase === 'COMPLETED',
      frameSamplesEvaluated: this.framesEvaluated,
      sequenceTimestamps: {
        openInitialAt: this.openInitialAt,
        closedAt: this.closedAt,
        challengeActionAt: this.challengeActionAt,
        reopenedAt: this.reopenedAt,
      },
    };

    return {
      stage: this.stage,
      challengePhase: this.challengePhase,
      currentEar: Number(currentEar.toFixed(3)),
      leftEar: Number(leftEar.toFixed(3)),
      rightEar: Number(rightEar.toFixed(3)),
      baselineOpenEar: Number(this.baselineOpenEar.toFixed(3)),
      blinkDetected: this.blinkCount > 0,
      motionVarianceScore,
      instruction: this.getInstruction(),
      captureRoleNeeded,
      telemetry,
    };
  }
}
