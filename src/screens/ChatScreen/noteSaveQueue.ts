// Autosaves and background meeting replacements share ordering even after the
// editor unmounts. A failed write must not block the next save or another note.
const pending = new Map<number, Promise<unknown>>();
export function enqueueNoteSave<T>(id: number, save: () => Promise<T>): Promise<T> {
  const next = (pending.get(id) || Promise.resolve()).catch(() => {}).then(save);
  pending.set(id, next);
  const clear = () => { if (pending.get(id) === next) pending.delete(id); };
  void next.then(clear, clear);
  return next;
}
