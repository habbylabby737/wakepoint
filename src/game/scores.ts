export type ScoreEntry = {
  name: string;
  score: number;
  wave: number;
  at: number;
};

const KEY = "wakepoint-scores-v1";
const SAVE_VERSION = 1;
export const MAX_SCORES = 8;

type SaveBlob = {
  version: number;
  entries: ScoreEntry[];
};

function defaults(): SaveBlob {
  return { version: SAVE_VERSION, entries: [] };
}

function migrate(raw: SaveBlob): SaveBlob {
  const next = { ...defaults(), ...raw, entries: Array.isArray(raw.entries) ? raw.entries : [] };
  next.version = SAVE_VERSION;
  return next;
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SaveBlob;
    return migrate(parsed)
      .entries.filter((e) => e && typeof e.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

export function qualifies(score: number): boolean {
  if (score <= 0) return false;
  const list = loadScores();
  return list.length < MAX_SCORES || score > list[list.length - 1]!.score;
}

export function submitScore(entry: Omit<ScoreEntry, "at">): ScoreEntry[] {
  const next: ScoreEntry[] = [
    ...loadScores(),
    { ...entry, name: entry.name.trim().slice(0, 16) || "Pilot", at: Date.now() },
  ]
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, MAX_SCORES);
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: SAVE_VERSION, entries: next }));
  } catch {
    /* private mode / quota */
  }
  return next;
}
