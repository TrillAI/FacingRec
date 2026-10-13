// Security Camera DVR Buffer & Video Clip Recording Manager
// Maintains continuous rolling 60-second video buffer for instant rewind, incident markers, and video clip exports.

export interface DvrIncidentMarker {
  id: string;
  timestamp: number;
  type: 'intruder' | 'recognized' | 'possible';
  label: string;
  distance?: number | null;
  thumbnail?: string;
  box?: { x: number; y: number; width: number; height: number };
}

export class DvrManager {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: { data: Blob; timestamp: number }[] = [];
  private maxBufferDurationMs = 60000; // Rolling 60-second DVR buffer
  private isRecording = false;
  private markers: DvrIncidentMarker[] = [];
  private activeStream: MediaStream | null = null;

  get recording(): boolean {
    return this.isRecording;
  }

  get incidentMarkers(): DvrIncidentMarker[] {
    return this.markers;
  }

  get bufferDurationSec(): number {
    if (!this.chunks.length) return 0;
    const now = Date.now();
    const oldest = this.chunks[0].timestamp;
    return Math.max(0, Math.round((now - oldest) / 1000));
  }

  /**
   * Starts continuous background rolling DVR recording on the active camera/screen stream.
   */
  startContinuousBuffer(stream: MediaStream) {
    this.stop();
    this.activeStream = stream;

    if (typeof window === 'undefined' || !window.MediaRecorder) {
      return;
    }

    // Pick best supported MIME type
    let mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
    }

    try {
      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const now = Date.now();
          this.chunks.push({ data: e.data, timestamp: now });

          // Prune chunks older than maxBufferDurationMs
          const cutoff = now - this.maxBufferDurationMs;
          while (this.chunks.length > 1 && this.chunks[0].timestamp < cutoff) {
            this.chunks.shift();
          }
        }
      };

      this.mediaRecorder.start(1000); // 1-second chunks for granular rewind
      this.isRecording = true;
    } catch {
      // MediaRecorder might fail if hardware encoder is busy
      this.isRecording = false;
    }
  }

  /**
   * Stops DVR recording and clears buffer.
   */
  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;
    this.isRecording = false;
    this.chunks = [];
  }

  /**
   * Records an incident marker along the DVR timeline.
   */
  addIncidentMarker(marker: Omit<DvrIncidentMarker, 'id'>) {
    const item: DvrIncidentMarker = {
      id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...marker,
    };
    this.markers.push(item);
    // Keep last 40 markers
    if (this.markers.length > 40) {
      this.markers.shift();
    }
    return item;
  }

  /**
   * Exports the rolling DVR buffer as a downloadable .webm incident clip.
   */
  exportDvrClip(filenamePrefix = 'dvr-incident'): Blob | null {
    if (!this.chunks.length) return null;
    const blobs = this.chunks.map((c) => c.data);
    const clipBlob = new Blob(blobs, { type: 'video/webm' });

    try {
      const url = URL.createObjectURL(clipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      // ignore
    }

    return clipBlob;
  }
}

export const dvrManager = new DvrManager();
