// Camera access. Phones require HTTPS (or localhost) for getUserMedia.
export async function startCamera(video, facing = 'user') {
  stopCamera(video);
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not available. Open this app over HTTPS (or localhost) in a current browser.');
  }
  const want = {
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(want);
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('Camera permission denied. Allow camera access and reload.');
    if (e.name === 'NotFoundError') throw new Error('No camera found on this device.');
    if (e.name === 'OverconstrainedError') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } else {
      throw e;
    }
  }
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (video.readyState < 2) {
    await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
  }
  return stream;
}

export function stopCamera(video) {
  const s = video.srcObject;
  if (s?.getTracks) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
