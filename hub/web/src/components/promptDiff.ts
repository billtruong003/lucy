// PA-D — diff line-level (LCS) cho side-by-side compare + versioned history.
// Không thêm dependency: LCS thuần trên mảng dòng. Dùng cho 2 prompt (cũ vs mới / 2 biến thể / bản gốc vs bản sửa).

export type DiffRow = { kind: 'same' | 'add' | 'del'; left: string | null; right: string | null }

// LCS trên các dòng → chuỗi thao tác same/add/del (align trái-phải).
export function diffLines(a: string, b: string): DiffRow[] {
  const L = (a || '').replace(/\r\n/g, '\n').split('\n')
  const R = (b || '').replace(/\r\n/g, '\n').split('\n')
  const n = L.length, m = R.length
  // bảng độ dài LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = L[i] === R[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const rows: DiffRow[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (L[i] === R[j]) { rows.push({ kind: 'same', left: L[i], right: R[j] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ kind: 'del', left: L[i], right: null }); i++ }
    else { rows.push({ kind: 'add', left: null, right: R[j] }); j++ }
  }
  while (i < n) { rows.push({ kind: 'del', left: L[i], right: null }); i++ }
  while (j < m) { rows.push({ kind: 'add', left: null, right: R[j] }); j++ }
  return rows
}

// Thống kê nhanh cho badge: số dòng thêm/bớt.
export function diffStat(a: string, b: string): { add: number; del: number } {
  let add = 0, del = 0
  for (const r of diffLines(a, b)) { if (r.kind === 'add') add++; else if (r.kind === 'del') del++ }
  return { add, del }
}
