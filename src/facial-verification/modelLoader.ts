import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * Browser Model Loader (MediaPipe FaceLandmarker)
 *
 * Loads MediaPipe FaceLandmarker locally from /models/face_landmarker.task + /mediapipe/wasm
 * for real-time 30 FPS 478-point 3D facial tracking, blendshape eye closure, and challenge capture.
 *
 * Biometric face detection (SCRFD-500M) and 512-D ArcFace identity inference run on the
 * trusted Node.js server over captured evidence frames—avoiding client-side ONNX/WASM tampering
 * and preventing browser dynamic-import issues under Vite.
 */

export interface ModelLoadProgress {
  loaded: boolean;
  stage: string;
  percent: number;
}

let primaryModelsLoaded = false;
let primaryLoadingPromise: Promise<void> | null = null;
let faceLandmarkerInstance: FaceLandmarker | null = null;
let activeDelegate: 'CPU' | 'GPU' = 'CPU';
let logFilterInstalled = false;

const BENIGN_TFLITE_STDERR_PATTERN =
  /^(?:INFO:\s*Created TensorFlow Lite XNNPACK delegate for CPU\b|(?:INFO|WARNING):\s*All log messages before absl::InitializeLog)/i;

function installBenignTfliteLogFilter(): void {
  if (logFilterInstalled || typeof console === 'undefined') return;
  logFilterInstalled = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && BENIGN_TFLITE_STDERR_PATTERN.test(first.trim())) {
      console.info(...args);
      return;
    }
    originalError(...args);
  };
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  return isMobileUa || (isTouch && (typeof window !== 'undefined' && window.innerWidth < 1024));
}

function isWebGL2Supported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('experimental-webgl2'));
  } catch {
    return false;
  }
}

export function areFaceModelsLoaded(): boolean {
  return primaryModelsLoaded && faceLandmarkerInstance !== null;
}

export function getFaceLandmarker(): FaceLandmarker | null {
  return faceLandmarkerInstance;
}

export function getActiveDelegate(): 'CPU' | 'GPU' {
  return activeDelegate;
}

async function resolveVisionFileset(): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
  // First attempt: local /mediapipe/wasm
  try {
    return await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  } catch (localErr) {
    console.warn('[FaceLandmarker] Local /mediapipe/wasm failed, trying CDN fallback...', localErr);
  }

  // Second attempt: jsdelivr CDN
  try {
    return await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
    );
  } catch (cdnErr) {
    console.warn('[FaceLandmarker] CDN fallback failed, retrying local with relative path...', cdnErr);
  }

  // Third attempt: relative path
  return await FilesetResolver.forVisionTasks('./mediapipe/wasm');
}

export async function createMediaPipeFaceLandmarker(
  modelBaseUrl: string,
  forceCpu = false
): Promise<FaceLandmarker> {
  installBenignTfliteLogFilter();
  const vision = await resolveVisionFileset();
  const modelAssetPath = `${modelBaseUrl}/face_landmarker.task`;

  const commonOptions = {
    runningMode: 'VIDEO' as const,
    numFaces: 4,
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
    outputFaceBlendshapes: true,
  };

  const isMobile = isMobileDevice();

  // On mobile browsers (Android Chrome, iOS Safari), WebGL GPU delegate often crashes
  // during video texture binding or loses WebGL context. The CPU delegate (WASM SIMD via XNNPACK)
  // is 100% stable, deterministic, uses ~15-20ms per frame, and avoids WebGL texture failures.
  if (!forceCpu && !isMobile && isWebGL2Supported()) {
    try {
      console.log('[FaceLandmarker] Initializing with GPU delegate (Desktop WebGL2)...');
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
        ...commonOptions,
      });
      activeDelegate = 'GPU';
      console.log('[FaceLandmarker] GPU delegate initialized successfully');
      return landmarker;
    } catch (gpuErr) {
      console.warn('[FaceLandmarker] GPU delegate failed, falling back to CPU delegate:', gpuErr);
    }
  }

  console.log(`[FaceLandmarker] Initializing with CPU delegate (WASM XNNPACK SIMD, mobile=${isMobile})...`);
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath,
      delegate: 'CPU',
    },
    ...commonOptions,
  });
  activeDelegate = 'CPU';
  console.log('[FaceLandmarker] CPU delegate initialized successfully');
  return landmarker;
}

export async function switchToCpuDelegate(modelBaseUrl = '/models'): Promise<FaceLandmarker> {
  console.warn('[FaceLandmarker] Runtime fallback: switching to CPU delegate...');
  try {
    if (faceLandmarkerInstance) {
      try {
        faceLandmarkerInstance.close();
      } catch {
        // Ignore close error on damaged instance
      }
      faceLandmarkerInstance = null;
    }
    const landmarker = await createMediaPipeFaceLandmarker(modelBaseUrl, true);
    faceLandmarkerInstance = landmarker;
    activeDelegate = 'CPU';
    return landmarker;
  } catch (err) {
    console.error('[FaceLandmarker] Failed to switch to CPU delegate:', err);
    throw err;
  }
}

export function setFaceLandmarkerInstance(instance: FaceLandmarker | null): void {
  faceLandmarkerInstance = instance;
}

export async function loadPretrainedFaceModels(
  modelBaseUrl = '/models',
  onProgress?: (progress: ModelLoadProgress) => void
): Promise<void> {
  if (primaryModelsLoaded && faceLandmarkerInstance) {
    onProgress?.({ loaded: true, stage: 'FaceLandmarker ready', percent: 100 });
    return;
  }
  if (primaryLoadingPromise) {
    return primaryLoadingPromise;
  }

  primaryLoadingPromise = (async () => {
    try {
      onProgress?.({
        loaded: false,
        stage: 'Loading MediaPipe FaceLandmarker...',
        percent: 30,
      });

      const landmarker = await createMediaPipeFaceLandmarker(modelBaseUrl);
      faceLandmarkerInstance = landmarker;
      primaryModelsLoaded = true;

      onProgress?.({
        loaded: true,
        stage: 'FaceLandmarker ready',
        percent: 100,
      });
    } catch (err) {
      primaryLoadingPromise = null;
      faceLandmarkerInstance = null;
      throw new Error(
        `Failed to load facial tracking model from ${modelBaseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  })();

  return primaryLoadingPromise;
}
