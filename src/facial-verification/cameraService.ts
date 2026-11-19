/**
 * Camera Service Module
 * Handles orientation-aware front-camera initialization, permission error translation,
 * lighting luminance assessment, and deterministic track cleanup.
 */

export interface CameraStartResult {
  stream: MediaStream;
  deviceLabel: string;
  width: number;
  height: number;
}

export function isCameraApiSupported(): boolean {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export async function startFrontCamera(
  videoEl: HTMLVideoElement
): Promise<CameraStartResult> {
  if (!isCameraApiSupported()) {
    throw new Error(
      'Camera API (MediaDevices.getUserMedia) is unavailable in this browser or context. Ensure HTTPS or localhost is used.'
    );
  }

  const isPortraitViewport =
    typeof window !== 'undefined' && window.innerHeight > window.innerWidth;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: isPortraitViewport ? 720 : 1280 },
        height: { ideal: isPortraitViewport ? 1280 : 720 },
        frameRate: { ideal: 30, min: 15 },
      },
      audio: false,
    });
  } catch (initialErr) {
    // Graceful fallback for mobile browsers that reject strict frameRate/resolution constraints
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } catch (err) {
        const domErr = err as DOMException;
        if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
          throw new Error(
            'Camera permission was denied. Allow camera access in your browser settings and reload.'
          );
        }
        if (domErr?.name === 'NotFoundError' || domErr?.name === 'DevicesNotFoundError') {
          throw new Error('No camera device was detected on this device.');
        }
        if (domErr?.name === 'NotReadableError' || domErr?.name === 'TrackStartError') {
          throw new Error(
            'Camera hardware is busy in another application. Close other camera apps and retry.'
          );
        }
        throw new Error(domErr?.message || 'Unable to start device front camera.');
      }
    }
  }

  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      videoEl
        .play()
        .then(() => resolve())
        .catch(reject);
    };
    if (videoEl.readyState >= 2) {
      onLoaded();
    } else {
      videoEl.onloadedmetadata = onLoaded;
    }
  });

  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();

  return {
    stream,
    deviceLabel: videoTrack?.label || 'Front Camera',
    width: settings?.width || videoEl.videoWidth || 1280,
    height: settings?.height || videoEl.videoHeight || 720,
  };
}

export function stopCameraStream(
  stream: MediaStream | null,
  videoEl?: HTMLVideoElement | null
): void {
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

/**
 * Estimates average scene luminance (0-255) from a video frame on an offscreen canvas.
 */
export function measureFrameLuminance(
  videoEl: HTMLVideoElement,
  scratchCanvas: HTMLCanvasElement
): number {
  if (videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) {
    return 0;
  }
  const w = 80;
  const h = 60;
  scratchCanvas.width = w;
  scratchCanvas.height = h;
  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;

  ctx.drawImage(videoEl, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let total = 0;
  const pixels = w * h;
  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return Math.round(total / pixels);
}
