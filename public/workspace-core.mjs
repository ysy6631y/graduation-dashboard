export function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

export class WorkspaceConflict extends Error {
  constructor(latest, message = '같은 항목이 변경됐어요. 입력은 유지했으니 최신 내용을 확인하고 다시 저장해주세요.') {
    super(message); this.name = 'WorkspaceConflict'; this.latest = latest;
  }
}

function mergeFields(before, proposed, latest, conflict) {
  const result = structuredClone(latest);
  for (const key of new Set([...Object.keys(before), ...Object.keys(proposed)])) {
    if (equal(before[key], proposed[key])) continue;
    if (!equal(latest[key], before[key]) && !equal(latest[key], proposed[key])) conflict();
    if (Object.hasOwn(proposed, key)) result[key] = structuredClone(proposed[key]);
    else delete result[key];
  }
  return result;
}

function mergeRecords(before, proposed, latest, latestState) {
  const originals = new Map(before.map(item => [item.id, item]));
  const drafts = new Map(proposed.map(item => [item.id, item]));
  const result = new Map(latest.map(item => [item.id, structuredClone(item)]));
  const conflict = () => { throw new WorkspaceConflict(latestState); };
  for (const id of new Set([...originals.keys(), ...drafts.keys()])) {
    const old = originals.get(id), next = drafts.get(id), current = result.get(id);
    if (equal(old, next)) continue;
    if (!old) {
      if (current && !equal(current, next)) conflict();
      result.set(id, structuredClone(next));
    } else if (!next) {
      if (current && !equal(current, old)) conflict();
      result.delete(id);
    } else {
      if (!current || (!old.deletedAt && current.deletedAt && !next.deletedAt)) conflict();
      result.set(id, mergeFields(old, next, current, conflict));
    }
  }
  return [...result.values()];
}

export function mergeWorkspace(before, proposed, latest) {
  const metadata = item => Object.fromEntries(Object.entries(item).filter(([key]) => !['tasks', 'events', 'links', 'revision'].includes(key)));
  const conflict = () => { throw new WorkspaceConflict(latest); };
  return {
    ...mergeFields(metadata(before), metadata(proposed), metadata(latest), conflict),
    revision: latest.revision,
    tasks: mergeRecords(before.tasks, proposed.tasks, latest.tasks, latest),
    events: mergeRecords(before.events, proposed.events, latest.events, latest),
    links: mergeFields(before.links, proposed.links, latest.links, conflict),
  };
}

export const emptyWorkspace = () => ({revision: 0, tasks: [], events: [], links: {}});
export const eventDate = event => event.kind === 'review' ? event.startDate || event.date : event.endDate || event.date;
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
// Hide only completed records from a closed review cycle, never overdue unfinished work.
// Legacy records without a completion day use their deadline; no data is deleted.
export function showTaskOnHome(task, events, day) {
  if (!task.done) return true;
  const closed = events.filter(event => !event.deletedAt && !event.demo && event.kind === 'review' &&
    (!event.project || event.project === task.project) && (event.endDate || event.date) < day);
  const cutoff = closed.map(event => event.endDate || event.date).sort().at(-1);
  const linked = events.find(event => event.id === task.dueMode);
  const completed = task.completedOn || (task.dueMode === 'custom' ? task.due : linked && eventDate(linked));
  return !cutoff || !completed || completed > cutoff;
}
export const safeURL = value => {
  if (value === '') return true;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
};

export function validWorkspace(input) {
  if (!input || !Array.isArray(input.tasks) || !Array.isArray(input.events) || !input.links || typeof input.links !== 'object' || Array.isArray(input.links)) return false;
  if (input.tasks.length > 5000 || input.events.length > 1000 || Object.keys(input.links).length > 100) return false;
  if (!Object.values(input.links).every(value => typeof value === 'string' && value.length <= 4000 && safeURL(value))) return false;
  if (new Set(input.tasks.map(t => t?.id)).size !== input.tasks.length || new Set(input.events.map(e => e?.id)).size !== input.events.length) return false;
  const record = item => item && typeof item.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(item.id) && typeof item.title === 'string' && item.title.trim().length > 0 && (item.demo === undefined || typeof item.demo === 'boolean') && (item.deletedAt == null || typeof item.deletedAt === 'string' && Number.isFinite(Date.parse(item.deletedAt)));
  if (!input.events.every(event => {
    if (!record(event) || event.title.length > 100 || !validDate(event.date) || !['review', 'final', 'milestone'].includes(event.kind) || !['', '리비두비', '룸'].includes(event.project)) return false;
    if (event.startDate === undefined && event.endDate === undefined) return true;
    return validDate(event.startDate) && validDate(event.endDate) && event.startDate <= event.endDate && event.date === eventDate(event);
  })) return false;
  return input.tasks.every(task => record(task) && task.title.length <= 300 && ['리비두비', '룸'].includes(task.project) &&
    Array.isArray(task.assignees) && task.assignees.length <= 20 && task.assignees.every(name => typeof name === 'string' && name.trim() && name.length <= 100) &&
    typeof task.done === 'boolean' && (task.completedOn == null || validDate(task.completedOn)) &&
    (task.link === undefined || typeof task.link === 'string') && (task.link || '').length <= 4000 && safeURL(task.link || '') &&
    (task.dueMode === 'custom' ? task.due === '' || validDate(task.due) : input.events.some(event => event.id === task.dueMode)));
}

export async function persistWorkspace(adapter, before, proposed, {attempts = 8} = {}) {
  let expected = before.revision, candidate = structuredClone(proposed);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await adapter.compareAndSwap(expected, candidate);
    if (result.ok) return result.state;
    const latest = result.state || await adapter.read();
    candidate = mergeWorkspace(before, proposed, latest);
    if (!validWorkspace(candidate)) throw new WorkspaceConflict(latest, '변경된 일정과 입력한 날짜를 함께 확인해주세요. 입력은 유지했어요.');
    expected = latest.revision;
    if (attempt) await new Promise(resolve => setTimeout(resolve, Math.min(200, 20 * 2 ** attempt) + Math.random() * 30));
  }
  throw new WorkspaceConflict(await adapter.read(), '변경이 많아 저장을 기다리고 있어요. 입력은 유지했으니 다시 저장해주세요.');
}

export function changedFields(before, proposed) {
  return Object.fromEntries(Object.entries(proposed).filter(([key, value]) => !equal(before[key], value)));
}
