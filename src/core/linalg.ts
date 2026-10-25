/** Small dense linear algebra for the calibration fit (matrices are a few × a few). */

export type Matrix = number[][];

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i]![i] = 1;
  return m;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. Returns null if singular. */
export function solve(A: Matrix, b: readonly number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < 1e-300) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const pr = M[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = M[r]!;
      const f = row[col]! / pr[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c]! -= f * pr[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r]!;
    let s = row[n]!;
    for (let c = r + 1; c < n; c++) s -= row[c]! * x[c]!;
    x[r] = s / row[r]!;
  }
  return x;
}

/** Inverse of a square matrix, or null if singular. */
export function invert(A: Matrix): Matrix | null {
  const n = A.length;
  const inv = zeros(n, n);
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const col = solve(A, e);
    if (!col) return null;
    for (let i = 0; i < n; i++) inv[i]![j] = col[i]!;
  }
  return inv;
}
