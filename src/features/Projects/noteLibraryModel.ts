import type { Project } from '../../data/project';

export type LibraryNote = { id: number; name: string; projectName: string };
export type NoteSort = 'newest' | 'oldest' | 'title';
export type LibraryPreferences = { sort: NoteSort };
export const LIBRARY_PREFERENCES_KEY = 'platypus.noteLibrary.v1';
export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = {
  sort: 'newest',
};

export function parseLibraryPreferences(value: string | null): LibraryPreferences {
  try {
    const parsed = JSON.parse(value || '{}');
    return {
      sort: ['newest', 'oldest', 'title'].includes(parsed?.sort) ? parsed.sort : 'newest',
    };
  } catch {
    return { ...DEFAULT_LIBRARY_PREFERENCES };
  }
}

export function collectNotes(projects: Project[]): LibraryNote[] {
  return projects.flatMap(project => project.activities.map((id, index) => ({
    id, name: project.activity_names[index]?.trim() || 'Untitled Note', projectName: project.name,
  })));
}

export function selectLibraryNotes(
  notes: LibraryNote[], query: string, contentMatchIds: ReadonlySet<number>, preferences: LibraryPreferences,
): LibraryNote[] {
  const term = query.trim().toLocaleLowerCase();
  return notes.filter(note =>
    (!term || note.name.toLocaleLowerCase().includes(term) ||
      note.projectName.toLocaleLowerCase().includes(term) || contentMatchIds.has(note.id))
  ).sort((a, b) => {
    if (preferences.sort === 'title') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || b.id - a.id;
    return preferences.sort === 'oldest' ? a.id - b.id : b.id - a.id;
  });
}
