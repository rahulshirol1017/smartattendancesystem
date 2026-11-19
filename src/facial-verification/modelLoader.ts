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

function isWebGL2Supported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
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

async function createMediaPipeFaceLandmarker(modelBaseUrl: string): Promise<FaceLandmarker> {
  installBenignTfliteLogFilter();
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const modelAssetPath = `${modelBaseUrl}/face_landmarker.task`;

  const commonOptions = {
    runningMode: 'VIDEO' as const,
    numFaces: 4,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputFaceBlendshapes: true,
  };

  if (isWebGL2Supported()) {
    try {
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
        ...commonOptions,
      });
    } catch {
      // Fall through to XNNPACK CPU delegate
    }
  }

  return await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath,
      delegate: 'CPU',
    },
    ...commonOptions,
  });
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
