/** Authoring needs a strict boundary; importing may recover a partially malformed path. */
export function validatePathData(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200000 || !/^\s*[mM]/.test(value))
    return "Enter SVG path data beginning with M (maximum 200000 characters).";
  const counts: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0,
  };
  const numberToken = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/iy;
  let index = 0;
  const skipSeparators = () => {
    while (/[\s,]/.test(value[index] ?? "") && index < value.length) index++;
  };
  const readNumber = (): number | null => {
    skipSeparators();
    numberToken.lastIndex = index;
    const match = numberToken.exec(value);
    if (!match) return null;
    index = numberToken.lastIndex;
    const number = Number(match[0]);
    return Number.isFinite(number) && Math.abs(number) <= 1e7 ? number : null;
  };
  const readFlag = () => {
    skipSeparators();
    return value[index] === "0" || value[index] === "1" ? value[index++] : null;
  };
  while (index < value.length) {
    skipSeparators();
    if (index === value.length) break;
    const command = value[index++]!.toUpperCase();
    if (!Object.hasOwn(counts, command)) return `Unsupported path command: ${command}.`;
    if (command === "Z") continue;
    let groups = 0;
    while (index < value.length) {
      skipSeparators();
      if (index === value.length || /[a-z]/i.test(value[index]!)) break;
      if (command === "A") {
        const rx = readNumber();
        const ry = readNumber();
        const rotation = readNumber();
        if (rx === null || ry === null || rotation === null || rx < 0 || ry < 0)
          return "Arc radii must be non-negative and all coordinates must be finite within ±10000000.";
        if (readFlag() === null || readFlag() === null) return "Arc flags must be 0 or 1.";
        if (readNumber() === null || readNumber() === null)
          return "Complete both arc endpoint coordinates.";
      } else {
        for (let argument = 0; argument < counts[command]!; argument++) {
          if (readNumber() === null)
            return `Complete the ${command} command with finite coordinates within ±10000000.`;
        }
      }
      groups++;
    }
    if (!groups) return `Complete the ${command} path command.`;
  }
  return null;
}
