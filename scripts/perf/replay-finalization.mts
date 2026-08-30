export interface ReplayFinalizationSample {
  readonly roomCode: string | null;
  readonly dispatchedAt: number;
  replayFinalizationLatencyMs: number;
  error?: string;
}

interface ReplayFinalizationMonitorOptions {
  readonly requestTimeoutMs: number;
  readonly readReadyRoomCodes: (roomCodes: readonly string[]) => Promise<ReadonlySet<string>>;
  readonly now?: () => number;
  readonly pollIntervalMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export interface ReplayFinalizationMonitor {
  track(sample: ReplayFinalizationSample): void;
  finish(): Promise<void>;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Poll replay readiness while finishes are still being dispatched. Samples
 * are timed from their own dispatch, not from the end of the paced wave. */
export function createReplayFinalizationMonitor(
  options: ReplayFinalizationMonitorOptions,
): ReplayFinalizationMonitor {
  const pending = new Map<string, ReplayFinalizationSample>();
  const now = options.now ?? performance.now.bind(performance);
  const wait = options.wait ?? defaultWait;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  let producerFinished = false;
  let wakeIdleMonitor: (() => void) | null = null;
  let failure: unknown;

  const notify = (): void => {
    const wake = wakeIdleMonitor;
    wakeIdleMonitor = null;
    wake?.();
  };

  const waitForTrackedSample = (): Promise<void> => new Promise((resolve) => {
    wakeIdleMonitor = resolve;
  });

  const run = async (): Promise<void> => {
    while (!producerFinished || pending.size > 0) {
      if (pending.size === 0) {
        await waitForTrackedSample();
        continue;
      }

      const readyRoomCodes = await options.readReadyRoomCodes([...pending.keys()]);
      const observedAt = now();
      for (const roomCode of readyRoomCodes) {
        const sample = pending.get(roomCode);
        if (!sample) continue;
        sample.replayFinalizationLatencyMs = observedAt - sample.dispatchedAt;
        pending.delete(roomCode);
      }
      for (const [roomCode, sample] of pending) {
        if (observedAt - sample.dispatchedAt < options.requestTimeoutMs) continue;
        sample.error = `${roomCode}: replay did not become ready within ${options.requestTimeoutMs}ms`;
        sample.replayFinalizationLatencyMs = observedAt - sample.dispatchedAt;
        pending.delete(roomCode);
      }

      if (pending.size > 0) await wait(pollIntervalMs);
    }
  };

  const completed = run().catch((error: unknown) => {
    failure = error;
  });

  return {
    track(sample): void {
      if (sample.error) return;
      if (!sample.roomCode) {
        sample.error = "finished game has no room code";
        return;
      }
      pending.set(sample.roomCode, sample);
      notify();
    },
    async finish(): Promise<void> {
      producerFinished = true;
      notify();
      await completed;
      if (failure) throw failure;
    },
  };
}
