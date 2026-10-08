/** Needleman-Wunsch sequence alignment used by automatic path morph repair. */

export const MATCH = 1;
export const MISMATCH = -1;
export const INDEL = 0;

export interface NWAlignment<T> {
  obj?: T;
}

export function align<T>(
  from: ReadonlyArray<T>,
  to: ReadonlyArray<T>,
  scoringFn: (fromItem: T, toItem: T) => number,
): { from: ReadonlyArray<NWAlignment<T>>; to: ReadonlyArray<NWAlignment<T>>; score: number } {
  const listA: NWAlignment<T>[] = from.map((obj) => ({ obj }));
  const listB: NWAlignment<T>[] = to.map((obj) => ({ obj }));
  const alignedListA: NWAlignment<T>[] = [];
  const alignedListB: NWAlignment<T>[] = [];

  listA.unshift({});
  listB.unshift({});

  const matrix: number[][] = [];
  for (let rowIndex = 0; rowIndex < listA.length; rowIndex++) {
    const row: number[] = [];
    for (let columnIndex = 0; columnIndex < listB.length; columnIndex++) {
      row.push(rowIndex === 0 ? columnIndex * INDEL : columnIndex === 0 ? rowIndex * INDEL : 0);
    }
    matrix.push(row);
  }

  for (let rowIndex = 1; rowIndex < listA.length; rowIndex++) {
    for (let columnIndex = 1; columnIndex < listB.length; columnIndex++) {
      const match =
        matrix[rowIndex - 1][columnIndex - 1] +
        scoringFn(listA[rowIndex].obj!, listB[columnIndex].obj!);
      const insertion = matrix[rowIndex][columnIndex - 1] + INDEL;
      const deletion = matrix[rowIndex - 1][columnIndex] + INDEL;
      matrix[rowIndex][columnIndex] = Math.max(match, insertion, deletion);
    }
  }

  let rowIndex = listA.length - 1;
  let columnIndex = listB.length - 1;

  while (rowIndex > 0 || columnIndex > 0) {
    if (
      rowIndex > 0 &&
      columnIndex > 0 &&
      matrix[rowIndex][columnIndex] ===
        matrix[rowIndex - 1][columnIndex - 1] +
          scoringFn(listA[rowIndex].obj!, listB[columnIndex].obj!)
    ) {
      alignedListA.unshift(listA[rowIndex--]);
      alignedListB.unshift(listB[columnIndex--]);
    } else if (
      rowIndex > 0 &&
      matrix[rowIndex][columnIndex] === matrix[rowIndex - 1][columnIndex] + INDEL
    ) {
      alignedListA.unshift(listA[rowIndex--]);
      alignedListB.unshift({});
    } else {
      alignedListA.unshift({});
      alignedListB.unshift(listB[columnIndex--]);
    }
  }

  return {
    from: alignedListA,
    to: alignedListB,
    score: matrix[listA.length - 1]?.[listB.length - 1] ?? 0,
  };
}
