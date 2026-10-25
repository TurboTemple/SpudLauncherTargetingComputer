/** Scans a QR code with the rear camera: the built-in BarcodeDetector where available, else jsQR. */

import { useEffect, useRef, useState } from 'preact/hooks';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const native = Native ? new Native({ formats: ['qr_code'] }) : null;
    let jsqr: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          let text: string | null = null;
          if (native) {
            text = (await native.detect(v))[0]?.rawValue ?? null;
          } else {
            jsqr ??= (await import('jsqr')).default;
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight * w) / v.videoWidth);
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            text = jsqr(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
          if (text) {
            onResult(text);
            return;
          }
        } catch {
          /* keep scanning */
        }
      }
      timer = setTimeout(() => void tick(), 200);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        void tick();
      })
      .catch((e: Error) => setError(e.message || 'Camera unavailable'));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div class="camera-view">
      <video ref={video} autoplay playsInline muted />
      <div class="scan-frame" aria-hidden="true" />
      <div class="camera-top">Point the camera at the spotter's QR code.{error && <span class="camera-error">{error}</span>}</div>
      <div class="camera-bottom">
        <button class="btn btn-big btn-primary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
