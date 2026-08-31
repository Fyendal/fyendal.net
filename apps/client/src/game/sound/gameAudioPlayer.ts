import type { GameSoundCue, GameSoundKind } from "./gameSoundCues.js";

const SOUND_URLS: Readonly<Record<GameSoundKind, readonly string[]>> = {
  draw: ["draw-1.ogg", "draw-2.ogg", "draw-3.ogg"],
  play: ["play-1.ogg", "play-2.ogg"],
  shuffle: ["shuffle.ogg"],
};

const CUE_GAIN: Readonly<Record<GameSoundKind, number>> = {
  draw: 0.55,
  play: 0.7,
  shuffle: 0.45,
};

const MAX_LATE_START_MS = 500;

function soundUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}audio/cards/${filename}`;
}

export class GameAudioPlayer {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly nextVariant: Record<GameSoundKind, number> = {
    draw: 0,
    play: 0,
    shuffle: 0,
  };
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private enabled = true;
  private volume = 0.35;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopActiveSources();
  }

  setVolume(percent: number): void {
    this.volume = Math.min(1, Math.max(0, percent / 100));
    if (this.context && this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.volume, this.context.currentTime);
    }
  }

  prepare(): Promise<void> {
    if (!this.enabled || typeof window === "undefined" || !window.AudioContext) {
      return Promise.resolve();
    }
    if (!this.context) {
      this.context = new window.AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.context.destination);
    }
    if (!this.loadPromise) {
      const context = this.context;
      const filenames = [...new Set(Object.values(SOUND_URLS).flat())];
      this.loadPromise = Promise.all(filenames.map(async (filename) => {
        try {
          const response = await fetch(soundUrl(filename));
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(filename, buffer);
        } catch {
          // Audio is optional presentation. A missing or unsupported sample
          // must never interrupt the game or repeatedly reject in the console.
        }
      })).then(() => undefined);
    }
    return this.loadPromise;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    void this.prepare();
    if (this.context?.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        // The next pointer or keyboard gesture will retry.
      }
    }
  }

  play(cues: readonly GameSoundCue[]): void {
    if (!this.enabled || cues.length === 0) return;
    const requestedAt = performance.now();
    void this.prepare().then(() => {
      if (
        !this.enabled
        || !this.context
        || !this.masterGain
        || this.context.state !== "running"
        || performance.now() - requestedAt > MAX_LATE_START_MS
      ) return;
      for (const cue of cues) this.startCue(cue);
    });
  }

  dispose(): void {
    this.stopActiveSources();
    const context = this.context;
    this.context = null;
    this.masterGain = null;
    this.loadPromise = null;
    this.buffers.clear();
    if (context) void context.close().catch(() => undefined);
  }

  private startCue(cue: GameSoundCue): void {
    if (!this.context || !this.masterGain) return;
    const variants = SOUND_URLS[cue.kind];
    const variantIndex = this.nextVariant[cue.kind] % variants.length;
    this.nextVariant[cue.kind] += 1;
    const filename = variants[variantIndex];
    const buffer = filename ? this.buffers.get(filename) : undefined;
    if (!buffer) return;

    const source = this.context.createBufferSource();
    const cueGain = this.context.createGain();
    source.buffer = buffer;
    cueGain.gain.value = CUE_GAIN[cue.kind];
    source.connect(cueGain);
    cueGain.connect(this.masterGain);
    source.onended = () => {
      this.activeSources.delete(source);
      source.disconnect();
      cueGain.disconnect();
    };
    this.activeSources.add(source);
    source.start(this.context.currentTime + Math.max(0, cue.delayMs) / 1_000);
  }

  private stopActiveSources(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // The source may already have naturally ended.
      }
    }
    this.activeSources.clear();
  }
}
