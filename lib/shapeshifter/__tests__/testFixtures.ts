/**
 * Test fixtures ported from the original Angular ShapeShifter
 * PathParser.spec.ts (8 spec groups, 14 test cases).
 *
 * Each fixture is a {before, after} pair testing parse -> serialize
 * normalization. The 'before' is the raw SVG path string input,
 * the 'after' is the expected normalized output from our serializer.
 *
 * NOTE: Our parser differs from the original in two ways:
 * 1. Arcs are preserved as endpoint commands (not converted to cubics)
 * 2. T/S shorthand commands are preserved (not expanded to Q/C)
 */

export interface ParseTest {
  description: string;
  before: string;
  after: string;
}

export interface ParseSpec {
  description: string;
  tests: ParseTest[];
}

export const parserSpecs: ParseSpec[] = [
  {
    description: "empty path data",
    tests: [
      { description: "empty string", before: "", after: "" },
    ],
  },
  {
    description: "paths with shorthand lineto commands",
    tests: [
      {
        description: "implicit lineto after moveto",
        before: "M 0 0 10 10 20 20 30 30",
        after: "M0 0 L10 10 L20 20 L30 30",
      },
      {
        description: "horizontal/vertical lineto",
        before: "M 0 0 h 10 v 10 h -10 v -10",
        after: "M0 0 L10 0 L10 10 L0 10 L0 0",
      },
    ],
  },
  {
    description: "sub paths begin with lowercase 'm'",
    tests: [
      {
        description: "single relative moveto subpath",
        before: "m 9 7 -1 1 -8 -8 L 10 10 Z",
        after: "M9 7 L8 8 L0 0 L10 10 Z",
      },
      {
        description: "relative moveto with negative values",
        before: "m -1 1 -15 0 0 -2 15 0 Z",
        after: "M-1 1 L-16 1 L-16 -1 L-1 -1 Z",
      },
      {
        description: "two relative moveto subpaths",
        before: "m 9 7 -1 1 -8 -8 L 10 10 Z m -1 1 -15 0 0 -2 15 0 Z",
        after: "M9 7 L8 8 L0 0 L10 10 ZM8 8 L-7 8 L-7 6 L8 6 Z",
      },
    ],
  },
  {
    description: "sub path begins with lineto command",
    tests: [
      {
        description: "implicit lineto shorthand",
        before: "l0.0.0.5.0.0.5-0.5.0.0-.5z",
        after: "L0 0 L0.5 0 L0.5 0.5 L0 0.5 L0 0 Z",
      },
    ],
  },
  {
    description: "arc commands preserved as endpoint",
    tests: [
      {
        description: "simple arc preserved",
        before: "M 0 0 A 5 5 0 1 0 10 0",
        after: "M0 0 A5 5 0 1 0 10 0",
      },
      {
        description: "relative arc in circle path",
        before: "M300,70 a230,230 0 1,0 1,0 z",
        after: "M300 70 A230 230 0 1 0 301 70 Z",
      },
    ],
  },
  {
    description: "paths with complex arcs and curves",
    tests: [
      {
        description: "complex compound path with arcs and curves",
        before:
          "M54,9.422c-6.555,6.043-13.558,13.787-17.812,22.27C31.93,23.209,24.926,15.465,18.372,9.422a101.486,101.486,0,0,0,17.811,1.564A101.5,101.5,0,0,0,54,9.422M72.367,0A96.572,96.572,0,0,1,36.183,6.986,96.567,96.567,0,0,1,0,0S36.183,23.482,36.183,46.964C36.183,23.482,72.367,0,72.367,0Z",
        after:
          "M54 9.422 C47.445 15.465 40.442 23.209 36.188 31.692 C31.93 23.209 24.926 15.465 18.372 9.422 A101.486 101.486 0 0 0 36.183 10.986 A101.5 101.5 0 0 0 54 9.422 M72.367 0 A96.572 96.572 0 0 1 36.183 6.986 A96.567 96.567 0 0 1 0 0 S36.183 23.482 36.183 46.964 C36.183 23.482 72.367 0 72.367 0 Z",
      },
      {
        description: "T shorthand preserved",
        before: "M 10 80 C 38.333 33.333 66.666 33.333 95 80 T 180 80",
        after: "M10 80 C38.333 33.333 66.666 33.333 95 80 T180 80",
      },
      {
        description: "quadratic with S shorthand preserved",
        before: "M10 80 Q 52.5 10, 95 80 T 180 80 S 150 150, 180 80",
        after: "M10 80 Q52.5 10 95 80 T180 80 S150 150 180 80",
      },
    ],
  },
  {
    description: "path with scientific notation",
    tests: [
      {
        description: "scientific notation in coordinates",
        before: "M2.000000,22.000000l20.000000,0.000000 1e0-2e3z",
        after: "M2 22 L22 22 L23 -1978 Z",
      },
    ],
  },
  {
    description: "miscellaneous paths",
    tests: [
      {
        description: "mixed command types",
        before:
          "M 1 1 m 2 2, l 3 3 L 3 3 H 4 h4 V5 v5, Q6 6 6 6 q 6 6 6 6t 7 7 T 7 7 C 8 8 8 8 8 8 c 8 8 8 8 8 8 S 9 9 9 9 s 9 9 9 9 A 10 10 0 1 1 10 10 a 10 10 0 1 1 10 10",
        after:
          "M1 1 M3 3 L6 6 L3 3 L4 3 L8 3 L8 5 L8 10 Q6 6 6 6 Q12 12 12 12 T19 19 T7 7 C8 8 8 8 8 8 C16 16 16 16 16 16 S9 9 9 9 S18 18 18 18 A10 10 0 1 1 10 10 A10 10 0 1 1 20 20",
      },
      {
        description: "circle-like path with precise decimals",
        before:
          "M 0.0,-1.0 l 0.0,0.0 c 0.5522847498,0.0 1.0,0.4477152502 1.0,1.0 l 0.0,0.0 c 0.0,0.5522847498 -0.4477152502,1.0 -1.0,1.0 l 0.0,0.0 c -0.5522847498,0.0 -1.0,-0.4477152502 -1.0,-1.0 l 0.0,0.0 c 0.0,-0.5522847498 0.4477152502,-1.0 1.0,-1.0 Z M 7.0,-9.0 c 0.0,0.0 -14.0,0.0 -14.0,0.0 c -1.1044921875,0.0 -2.0,0.8955078125 -2.0,2.0 c 0.0,0.0 0.0,14.0 0.0,14.0 c 0.0,1.1044921875 0.8955078125,2.0 2.0,2.0 c 0.0,0.0 14.0,0.0 14.0,0.0 c 1.1044921875,0.0 2.0,-0.8955078125 2.0,-2.0 c 0.0,0.0 0.0,-14.0 0.0,-14.0 c 0.0,-1.1044921875 -0.8955078125,-2.0 -2.0,-2.0 c 0.0,0.0 0.0,0.0 0.0,0.0 Z",
        after:
          "M0 -1 L0 -1 C0.552 -1 1 -0.552 1 0 L1 0 C1 0.552 0.552 1 0 1 L0 1 C-0.552 1 -1 0.552 -1 0 L-1 0 C-1 -0.552 -0.552 -1 0 -1 ZM7 -9 C7 -9 -7 -9 -7 -9 C-8.104 -9 -9 -8.104 -9 -7 C-9 -7 -9 7 -9 7 C-9 8.104 -8.104 9 -7 9 C-7 9 7 9 7 9 C8.104 9 9 8.104 9 7 C9 7 9 -7 9 -7 C9 -8.104 8.104 -9 7 -9 C7 -9 7 -9 7 -9 Z",
      },
      {
        description: "smile-like curved path",
        before:
          "M5.3,13.2c-0.1,0.0 -0.3,0.0 -0.4,-0.1c-0.3,-0.2 -0.4,-0.7 -0.2,-1.0c1.3,-1.9 2.9,-3.4 4.9,-4.5c4.1,-2.2 9.3,-2.2 13.4,0.0c1.9,1.1 3.6,2.5 4.9,4.4c0.2,0.3 0.1,0.8 -0.2,1.0c-0.3,0.2 -0.8,0.1 -1.0,-0.2c-1.2,-1.7 -2.6,-3.0 -4.3,-4.0c-3.7,-2.0 -8.3,-2.0 -12.0,0.0c-1.7,0.9 -3.2,2.3 -4.3,4.0C5.7,13.1 5.5,13.2 5.3,13.2z",
        after:
          "M5.3 13.2 C5.2 13.2 5 13.2 4.9 13.1 C4.6 12.9 4.5 12.4 4.7 12.1 C6 10.2 7.6 8.7 9.6 7.6 C13.7 5.4 18.9 5.4 23 7.6 C24.9 8.7 26.6 10.1 27.9 12 C28.1 12.3 28 12.8 27.7 13 C27.4 13.2 26.9 13.1 26.7 12.8 C25.5 11.1 24.1 9.8 22.4 8.8 C18.7 6.8 14.1 6.8 10.4 8.8 C8.7 9.7 7.2 11.1 6.1 12.8 C5.7 13.1 5.5 13.2 5.3 13.2 Z",
      },
    ],
  },
];

export interface AutoFixTest {
  from: string;
  to: string;
  expectedFrom: string;
  expectedTo: string;
}

export const autoFixTests: AutoFixTest[] = [
  {
    from: "M 2 2 L 12 2 L 12 12 L 2 12 L 2 2",
    to: "M 12 12 L 2 12 L 2 2 L 12 2 L 12 12",
    expectedFrom: "M12 12 L2 12 L2 2 L12 2 L12 12",
    expectedTo: "M12 12 L2 12 L2 2 L12 2 L12 12",
  },
];

export interface MutationTest {
  description: string;
  input: string;
  operation: "reverse" | "shift" | "shiftBack";
  steps?: number;
  expected: string;
}

export const mutationTests: MutationTest[] = [
  {
    description: "reverse open path",
    input: "M 0 0 L 10 10 L 20 20",
    operation: "reverse",
    expected: "M20 20 L10 10 L0 0",
  },
  {
    description: "reverse closed path",
    input: "M 0 0 L 10 10 L 20 20 Z",
    operation: "reverse",
    expected: "M20 20 L10 10 L0 0 Z",
  },
  {
    description: "reverse closed rectangle",
    input: "M 19 11 L 5 11 L 5 13 L 19 13 Z",
    operation: "reverse",
    expected: "M19 13 L5 13 L5 11 L19 11 Z",
  },
  {
    description: "reverse with cubic bezier",
    input: "M 19 11 C 19 11 5 11 5 11 C 5 11 5 13 5 13 L 19 13 L 19 11",
    operation: "reverse",
    expected: "M19 11 L19 13 L5 13 C5 13 5 11 5 11 C5 11 19 11 19 11",
  },
];
