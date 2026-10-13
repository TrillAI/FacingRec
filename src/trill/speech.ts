// Text-to-Speech Voice Announcer Module
// Speaks detected person's name aloud: "[Name] was recognized" with intelligent cooldown.
// Completely optional and user-controllable (ON/OFF).

class VoiceAnnouncer {
  private lastAnnounced = new Map<string, number>();
  private defaultCooldownMs = 15000; // 15 seconds cooldown per person so speech isn't repeated continuously

  get isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * Speaks the recognized person's name out loud: "[Name] was recognized"
   */
  announceRecognition(personName: string, options: { cooldownMs?: number; rate?: number } = {}) {
    if (!this.isSupported || !personName || personName.toLowerCase() === 'unknown') return;

    const cleanName = personName.trim();
    const now = Date.now();
    const cooldown = options.cooldownMs ?? this.defaultCooldownMs;
    const last = this.lastAnnounced.get(cleanName.toLowerCase()) || 0;

    if (now - last < cooldown) {
      // Cooldown in effect for this person
      return;
    }

    this.lastAnnounced.set(cleanName.toLowerCase(), now);

    try {
      window.speechSynthesis.cancel(); // Cancel any stale queuing
      const utterance = new SpeechSynthesisUtterance(`${cleanName} was recognized`);
      utterance.rate = options.rate ?? 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Select natural sounding voice if available
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        const preferred = voices.find(
          (v) =>
            v.lang.startsWith('en') &&
            (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Ava'))
        ) || voices.find((v) => v.lang.startsWith('en'));
        if (preferred) {
          utterance.voice = preferred;
        }
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  }

  /**
   * Reset cooldowns (e.g. when switching cameras or restarting session)
   */
  reset() {
    this.lastAnnounced.clear();
  }
}

export const voiceAnnouncer = new VoiceAnnouncer();
