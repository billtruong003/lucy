// C3: task quá to → phải decompose trước, executor không nhận
export const BRIEF_CHAR_MAX = 2000

export function briefTooLarge(brief: string): boolean {
  return brief.length > BRIEF_CHAR_MAX
}
