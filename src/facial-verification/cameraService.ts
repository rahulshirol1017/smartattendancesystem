/**
 * Camera Service Module
 * Handles mobile-compatible, orientation-aware front-camera initialization,
 * permission error translation, lighting luminance assessment, and deterministic cleanup.
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

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  return isMobileUa || (isTouch && (typeof window !== 'undefined' && window.innerWidth < 1024));
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
  const isMobile = isMobileDevice();

  let stream: MediaStream;

  // Optimized mobile camera constraints:
  // Mobile devices overheat and drop frames when negotiating 4K or unconstrained resolutions.
  // 720p or 640p provides crisp, full 478-landmark tracking with optimal 30 FPS inference.
  const idealWidth = isMobile
    ? (isPortraitViewport ? 540 : 720)
    : (isPortraitViewport ? 720 : 1280);
  const idealHeight = isMobile
    ? (isPortraitViewport ? 720 : 540)
    : (isPortraitViewport ? 1280 : 720);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: idealWidth, max: 1280 },
        height: { ideal: idealHeight, max: 1280 },
        frameRate: { ideal: 30, min: 15 },
      },
      audio: false,
    });
  } catch (initialErr) {
    console.warn('[CameraService] Tier-1 constraints rejected, trying relaxed user facingMode...', initialErr);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: idealWidth },
          height: { ideal: idealHeight },
        },
        audio: false,
      });
    } catch {
      try {
        console.warn('[CameraService] Tier-2 constraints rejected, trying basic facingMode: user...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
      } catch {
        try {
          console.warn('[CameraService] Tier-3 constraints rejected, falling back to bare video: true...');
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
  }

  // Critical configuration for iOS Safari & Android Chrome:
  // Must set muted, playsInline, autoPlay on DOM element BEFORE assigning srcObject
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.setAttribute('autoplay', 'true');
  videoEl.setAttribute('playsinline', 'true');
  videoEl.setAttribute('webkit-playsinline', 'true');
  videoEl.setAttribute('muted', 'true');
  videoEl.srcObject = stream;

  // Robustly wait until video metadata AND actual decoded frames are available
  await new Promise<void>((resolve, reject) => {
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[CameraService] Camera ready check timed out after 4s; proceeding with current state');
        resolve();
      }
    }, 4000);

    const checkReady = () => {
      if (resolved) return;
      if (
        videoEl.videoWidth > 0 &&
        videoEl.videoHeight > 0 &&
        (videoEl.readyState >= 2 || videoEl.currentTime > 0)
      ) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve();
      }
    };

    videoEl.onloadedmetadata = () => {
      videoEl
        .play()
        .then(checkReady)
        .catch((playErr) => {
          console.warn('[CameraService] video.play() warning:', playErr);
          checkReady();
        });
    };
    videoEl.onloadeddata = checkReady;
    videoEl.onplaying = checkReady;
    videoEl.ontimeupdate = checkReady;

    videoEl
      .play()
      .then(checkReady)
      .catch(() => {});
  });

  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();

  return {
    stream,
    deviceLabel: videoTrack?.label || 'Front Camera',
    width: settings?.width || videoEl.videoWidth || idealWidth,
    height: settings?.height || videoEl.videoHeight || idealHeight,
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
    videoEl.pause?.();
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
