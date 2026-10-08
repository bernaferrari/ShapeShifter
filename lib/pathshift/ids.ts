/**
 * Zero-dependency monotonic ULIDs for authored identities. The module-scoped
 * generator survives clock drift and increments randomness within a millisecond.
 * Existing valid identities are opaque and stable; missing or duplicated command
 * identities are repaired by ensureStableCommandIds.
 */

import type { PathData } from "./types";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars — no I, L, O, U

function encodeTime(timestamp: number, length: number): string {
  let value = BigInt(timestamp);
  let str = "";
  const b32 = BigInt(32);
  for (let i = 0; i < length; i++) {
    const mod = Number(value % b32);
    str = CROCKFORD_ALPHABET[mod] + str;
    value /= b32;
  }
  return str;
}

function encodeRandom(random: bigint, length: number): string {
  let value = random;
  let str = "";
  const b32 = BigInt(32);
  for (let i = 0; i < length; i++) {
    const mod = Number(value % b32);
    str = CROCKFORD_ALPHABET[mod] + str;
    value /= b32;
  }
  return str;
}

function decodeBase32(str: string): bigint {
  let value = BigInt(0);
  const upper = str.toUpperCase();
  const b32 = BigInt(32);
  for (const char of upper) {
    const idx = CROCKFORD_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid ULID character: ${char}`);
    }
    value = value * b32 + BigInt(idx);
  }
  return value;
}

// Module-scoped monotonic state (process local, not global across workers)
let lastTimestamp = 0;
let lastRandom = BigInt(0);

function getRandom80Bits(): bigint {
  const b1 = BigInt(1);
  const b8 = BigInt(8);
  const b80 = BigInt(80);
  const b48 = BigInt(48);
  const b16 = BigInt(16);
  const b80mask = (b1 << b80) - b1;

  // Prefer Web Crypto (available in browsers and modern Node/Next runtimes)
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(10); // 80 bits
    globalThis.crypto.getRandomValues(bytes);
    let r = BigInt(0);
    for (let i = 0; i < 10; i++) {
      r = (r << b8) | BigInt(bytes[i]);
    }
    return r & b80mask;
  }

  // High-quality fallback for test environments / old runtimes
  // (still extremely unlikely to collide in practice for our usage)
  const a = BigInt(Math.floor(Math.random() * 0xffffffff));
  const b = BigInt(Math.floor(Math.random() * 0xffffffff));
  const c = BigInt(Math.floor(Math.random() * 0xffff));
  return ((a << b48) | (b << b16) | c) & b80mask;
}

/**
 * Generate a new monotonic ULID.
 *
 * @param prefix Optional short prefix for human readability in dev tools
 *               (e.g. "cmd"). The core 26-char ULID is always unique and sortable.
 * @returns A stable, time-sortable identifier string.
 */
export function generateId(prefix?: string): string {
  const b1 = BigInt(1);
  const b80 = BigInt(80);

  let timestamp = Date.now();
  let random = getRandom80Bits();

  if (timestamp === lastTimestamp) {
    // Monotonic guarantee within the same millisecond
    random = lastRandom + b1;
    if (random >= b1 << b80) {
      // Extremely rare rollover — advance time
      timestamp = lastTimestamp + 1;
      random = getRandom80Bits();
    }
  } else if (timestamp < lastTimestamp) {
    // Clock moved backwards (NTP, VM restore, etc.). Preserve monotonicity.
    timestamp = lastTimestamp;
    random = lastRandom + b1;
  }

  lastTimestamp = timestamp;
  lastRandom = random;

  // 48 bits of time → 10 base32 chars (standard ULID)
  const timePart = encodeTime(timestamp, 10);
  // 80 bits of randomness → 16 base32 chars
  const randPart = encodeRandom(random, 16);

  const ulid = timePart + randPart; // exactly 26 characters

  return prefix ? `${prefix}_${ulid}` : ulid;
}

/**
 * Extract the original creation timestamp (milliseconds since epoch) from any ID
 * produced by this module (handles both plain ULIDs and prefixed variants).
 * Returns 0 for malformed input (never throws in hot paths).
 */
export function decodeTime(id: string): number {
  if (!id) return 0;
  const core = id.includes("_") ? id.split("_").pop()! : id;
  if (core.length < 10) return 0;
  const timePart = core.slice(0, 10);
  try {
    return Number(decodeBase32(timePart));
  } catch {
    return 0;
  }
}

/**
 * Pure function: walk a PathData and guarantee every Command has a high-quality
 * stable ID. Missing or duplicate identities get fresh monotonic ULIDs.
 *
 * Returns a new PathData (structuredClone + selective replacement). Never mutates input.
 * Idempotent for valid identities, regardless of their spelling.
 */
export function ensureStableCommandIds(pathData: PathData): PathData {
  const seen = new Set<string>();
  let dirty = false;

  const upgradedSubPaths = pathData.subPaths.map((sub) => {
    const upgradedCommands = sub.commands.map((cmd) => {
      const currentId = cmd.id;
      if (!currentId || seen.has(currentId)) {
        dirty = true;
        const fresh = generateId();
        seen.add(fresh);
        return { ...cmd, id: fresh };
      }

      seen.add(currentId);
      return cmd;
    });

    return { ...sub, commands: upgradedCommands };
  });

  if (!dirty) {
    return pathData; // identity when nothing needed fixing (common fast path)
  }

  return {
    ...pathData,
    subPaths: upgradedSubPaths,
    // _string cache is invalidated implicitly by any structural change
    _string: undefined,
  };
}

/**
 * Test-only escape hatch. Resets the monotonic clock/random state so tests
 * that assert ID ordering or exact generation are deterministic.
 * NEVER call from production code.
 */
export function __resetMonotonicStateForTests(): void {
  lastTimestamp = 0;
  lastRandom = BigInt(0);
}
