/** Drops out-of-order room notifications while allowing distinct message
 * types from the same committed version (for example game-started + state). */
export class RoomVersionGate {
  private latest = -1;
  private seenAtLatest = new Set<string>();

  reset(): void {
    this.latest = -1;
    this.seenAtLatest.clear();
  }

  /** Lets one more message of this type through at the current version, for
   * a reply that re-projects the same commit (a solo seat switch). */
  allowRepeat(type: string): void {
    this.seenAtLatest.delete(type);
  }

  current(): number {
    return this.latest;
  }

  accept(type: string, version: number): boolean {
    if (version < this.latest) return false;
    if (version > this.latest) {
      this.latest = version;
      this.seenAtLatest.clear();
    }
    if (this.seenAtLatest.has(type)) return false;
    this.seenAtLatest.add(type);
    return true;
  }
}
