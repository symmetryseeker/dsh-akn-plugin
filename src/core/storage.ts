/**
 * core/storage.ts — the in-memory content-addressed engine.
 *
 * - `store`: Map<id, KO> — immutable, content-addressed entries. A body edit
 *   yields a new id; old versions are retained for provenance.
 * - `reverseIndex`: Map<upstreamId, Set<downstreamId>> — maintained at save
 *   time from `ko.links.basis`, so cascade invalidation can walk "who depends
 *   on me" without scanning the whole store.
 *
 * This implementation is intentionally dependency-free so it can be swapped
 * for a durable backend (SQLite / LevelDB) behind the same IAknStorage port.
 */

import type { KO, AknSearchQuery } from "./types";

/** Port (interface) for any AKN storage backend. */
export interface IAknStorage {
  /** Persist a validated KO (idempotent — same id overwrites identical body). */
  save(ko: KO): void;
  /** Fetch by content-address id. Returns undefined when absent. */
  get(id: string): KO | undefined;
  /** Multi-field filtered search with title/summary keyword matching. */
  search(query: AknSearchQuery): KO[];
  /** All KO ids that list `id` in their links.basis (direct dependents). */
  dependents(id: string): ReadonlySet<string>;
  /** Total number of stored KOs. */
  size(): number;
  /** Enumerate all stored KOs (used by drift scans / stats). */
  values(): IterableIterator<KO>;
}

export class MemoryStorage implements IAknStorage {
  private store = new Map<string, KO>();
  /** upstreamId -> Set of downstream ids that depend on it via links.basis */
  private reverseIndex = new Map<string, Set<string>>();

  save(ko: KO): void {
    // Drop the previous reverse-index edges for this id first, so a KO
    // republished with a different links.basis never retains stale
    // "who depends on me" edges from its former upstreams (cascade would
    // otherwise invalidate a KO that no longer depends on the refuted node).
    const prev = this.store.get(ko.id);
    if (prev) {
      for (const basisId of prev.links.basis) {
        const bucket = this.reverseIndex.get(basisId);
        if (!bucket) continue;
        bucket.delete(ko.id);
        if (bucket.size === 0) this.reverseIndex.delete(basisId);
      }
    }

    this.store.set(ko.id, ko);

    // Maintain the reverse index: every upstream basis gets "who depends on me".
    for (const basisId of ko.links.basis) {
      let bucket = this.reverseIndex.get(basisId);
      if (!bucket) {
        bucket = new Set<string>();
        this.reverseIndex.set(basisId, bucket);
      }
      bucket.add(ko.id);
    }
  }

  get(id: string): KO | undefined {
    return this.store.get(id);
  }

  dependents(id: string): ReadonlySet<string> {
    return this.reverseIndex.get(id) ?? new Set<string>();
  }

  size(): number {
    return this.store.size;
  }

  values(): IterableIterator<KO> {
    return this.store.values();
  }

  search(query: AknSearchQuery): KO[] {
    const { filters, keyword } = query;
    const kw = keyword ? keyword.trim().toLowerCase() : "";
    const statusFilter = toSet(filters.status);

    const results: KO[] = [];
    for (const ko of this.store.values()) {
      if (filters.type && ko.body.type !== filters.type) continue;
      if (statusFilter.size > 0 && !statusFilter.has(ko.status)) continue;
      if (filters.tags && filters.tags.length > 0) {
        if (!ko.tags.some((t) => filters.tags!.includes(t))) continue;
      }
      if (kw) {
        const haystack = (ko.title + " " + ko.summary).toLowerCase();
        if (!haystack.includes(kw)) continue;
      }
      results.push(ko);
    }
    return results;
  }
}

/** Normalize a status or status-array filter into a Set. */
function toSet(status: AknSearchQuery["filters"]["status"]): Set<string> {
  if (!status) return new Set<string>();
  return new Set(Array.isArray(status) ? status : [status]);
}
