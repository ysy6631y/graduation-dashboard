export const STORAGE_KEY = "grad-exhibition-dashboard-v1";
export const BACKUP_KEY = `${STORAGE_KEY}-before-v2`;
export const STATUSES = ["진행 중", "확인 필요", "완료"];
export const MEMBERS = [
  { name: "이유진", initial: "유", className: "member-0" },
  { name: "임다혜", initial: "혜", className: "member-1" },
  { name: "강주원", initial: "원", className: "member-2" },
  { name: "윤서영", initial: "영", className: "member-3" },
];
export const PROJECTS = [
  { id: "Luum", name: "Luum", className: "luum" },
  { id: "LivyDuvy", name: "LiviDuvy", className: "livy" },
];
export const EXHIBITION_MILESTONES = [
  {
    id: "milestone-review-2026",
    name: "2차 졸전 심사",
    project: "공통",
    status: "진행 중",
    owner: "",
    assignees: {},
    start: "2026-10-21",
    end: "2026-10-21",
    description: "",
  },
  {
    id: "milestone-exhibition-2026",
    name: "졸업전시",
    project: "공통",
    status: "진행 중",
    owner: "",
    assignees: {},
    start: "2026-11-05",
    end: "2026-11-09",
    description: "",
  },
];
export const DEFAULT_STATE = {
  tasks: [
    {
      id: "luum-example",
      name: "[예시] Luum 패키지 디자인 최종 확인",
      project: "Luum",
      status: "진행 중",
      owner: "",
      start: "",
      end: "",
      description: "",
    },
    {
      id: "livy-example",
      name: "[예시] LivyDuvy UI 화면 최종 확인",
      project: "LivyDuvy",
      status: "진행 중",
      owner: "",
      start: "",
      end: "",
      description: "",
    },
  ],
  links: [
    {
      id: "luum-drive",
      label: "Luum",
      title: "브랜드 에셋 및 제작 자료",
      url: "",
    },
    { id: "livy-drive", label: "LivyDuvy", title: "UI/UX 및 3D 에셋", url: "" },
    { id: "budget", label: "공통", title: "예산 Google Sheets", url: "" },
    { id: "figma", label: "공통", title: "Figma 및 주요 공유 자료", url: "" },
  ],
};
export function localISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localISO(date);
}
export function dayDifference(a, b) {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000,
  );
}
export function taskAssignees(task) {
  if (
    task.assignees &&
    typeof task.assignees === "object" &&
    !Array.isArray(task.assignees)
  )
    return { ...task.assignees };
  return task.owner
    ? { [task.owner]: STATUSES.includes(task.status) ? task.status : "진행 중" }
    : {};
}
export function assigneeNames(task) {
  return Object.keys(taskAssignees(task));
}
export function primaryOwner(assignees) {
  return (
    MEMBERS.find((member) => Object.hasOwn(assignees, member.name))?.name ||
    Object.keys(assignees)[0] ||
    ""
  );
}
export function migrateState(input) {
  if (!input || !Array.isArray(input.tasks))
    throw new Error("저장된 작업 형식을 읽을 수 없습니다.");
  return {
    ...input,
    schemaVersion: 4,
    activity: Array.isArray(input.activity) ? input.activity : [],
    tasks: input.tasks.map((task, index) => ({
      ...task,
      id: task.id || `legacy-${index}`,
      name: String(task.name || "이름 없는 작업"),
      project:
        task.project === "LiviDuvy" ? "LivyDuvy" : task.project || "Luum",
      status: task.status === "할 일" ? "진행 중" : task.status || "진행 중",
      owner: primaryOwner(taskAssignees(task)),
      assignees: taskAssignees(task),
      start: task.start ?? task.due ?? "",
      end: task.end ?? task.due ?? "",
      description: task.description || "",
    })),
    links: Array.isArray(input.links)
      ? input.links
      : structuredClone(DEFAULT_STATE.links),
  };
}
export function loadState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return migrateState(structuredClone(DEFAULT_STATE));
  return migrateState(JSON.parse(raw));
}
export function persistState(storage, next) {
  // Keep the complete original payload once; unknown and legacy fields survive migration.
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null && !storage.getItem(BACKUP_KEY))
    storage.setItem(BACKUP_KEY, raw);
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export class ConcurrentEditError extends Error {
  constructor(message, latest) {
    super(message);
    this.name = "ConcurrentEditError";
    this.latest = latest;
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeFields(before, proposed, latest, conflict) {
  const merged = { ...latest };
  for (const key of new Set([
    ...Object.keys(before),
    ...Object.keys(proposed),
  ])) {
    if (same(before[key], proposed[key])) continue;
    if (!same(latest[key], before[key]) && !same(latest[key], proposed[key]))
      conflict();
    if (Object.hasOwn(proposed, key))
      merged[key] = structuredClone(proposed[key]);
    else delete merged[key];
  }
  return merged;
}
function mergeRecords(before, proposed, latest, kind, latestState) {
  const base = new Map(before.map((item) => [item.id, item]));
  const draft = new Map(proposed.map((item) => [item.id, item]));
  const result = new Map(latest.map((item) => [item.id, item]));
  const conflict = () => {
    throw new ConcurrentEditError(
      "다른 탭에서 같은 항목이 변경됐습니다. 최신 내용을 확인해주세요.",
      latestState,
    );
  };
  for (const id of new Set([...base.keys(), ...draft.keys()])) {
    const old = base.get(id),
      next = draft.get(id),
      current = result.get(id);
    if (same(old, next)) continue;
    if (!old) {
      if (current && !same(current, next)) conflict();
      result.set(id, next);
    } else if (!next) {
      if (current && !same(current, old)) conflict();
      result.delete(id);
    } else {
      if (!current) conflict();
      let merged;
      if (kind === "tasks") {
        // Each collaborator is an independently mergeable field. The old owner
        // string remains a compatibility mirror, never a second source of truth.
        const fields = (item) =>
          Object.fromEntries(
            Object.entries(item).filter(
              ([key]) => !["owner", "assignees"].includes(key),
            ),
          );
        merged = mergeFields(
          fields(old),
          fields(next),
          fields(current),
          conflict,
        );
        merged.assignees = mergeFields(
          taskAssignees(old),
          taskAssignees(next),
          taskAssignees(current),
          conflict,
        );
        merged.owner = primaryOwner(merged.assignees);
      } else merged = mergeFields(old, next, current, conflict);
      // Independent edits to start/end must still form a valid interval together.
      if (kind === "tasks" && validateTask(merged)) conflict();
      result.set(id, merged);
    }
  }
  return [...result.values()];
}
export function mergeState(before, proposed, latest) {
  const conflict = () => {
    throw new ConcurrentEditError("다른 탭의 변경사항과 충돌했습니다.", latest);
  };
  const root = (value) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => !["tasks", "links", "revision", "activity"].includes(key),
      ),
    );
  return {
    ...mergeFields(root(before), root(proposed), root(latest), conflict),
    tasks: mergeRecords(
      before.tasks,
      proposed.tasks,
      latest.tasks,
      "tasks",
      latest,
    ),
    links: mergeRecords(
      before.links,
      proposed.links,
      latest.links,
      "links",
      latest,
    ),
    activity: Array.isArray(latest.activity) ? latest.activity : [],
    revision: (Number(latest.revision) || 0) + 1,
  };
}

export async function persistRemote(adapter, before, proposed, environment = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await adapter.read();
    const latest = migrateState(snapshot.state);
    const merged = mergeState(before, proposed, latest);
    const additions = activityEntries(latest, merged, {
      source: environment.source || "edit",
    });
    if (environment.note) {
      const { taskId, member, text } = environment.note;
      const task = merged.tasks.find((item) => item.id === taskId);
      if (!task)
        throw new ConcurrentEditError(
          "작업이 삭제됐습니다. 기록할 작업을 다시 선택해주세요.",
          latest,
        );
      if (
        !MEMBERS.some((item) => item.name === member) ||
        !text?.trim() ||
        text.trim().length > 2000
      )
        throw new Error("팀원과 작업 내용을 확인해주세요.");
      additions.push({
        id:
          globalThis.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        at: new Date().toISOString(),
        taskId: task.id,
        taskName: task.name,
        project: task.project,
        members: [member],
        member,
        kind: "note",
        source: "note",
        text: text.trim(),
      });
    }
    merged.activity = [...(latest.activity || []), ...additions];
    merged.revision = snapshot.revision + 1;
    if (await adapter.compareAndSwap(snapshot.revision, merged)) return merged;
  }
  throw new ConcurrentEditError(
    "다른 팀원이 계속 수정 중입니다. 잠시 후 다시 저장해주세요.",
    (await adapter.read()).state,
  );
}

export function activityEntries(
  before,
  after,
  { source = "edit", now = new Date().toISOString() } = {},
) {
  const previous = new Map(before.tasks.map((task) => [task.id, task]));
  const next = new Map(after.tasks.map((task) => [task.id, task]));
  const entries = [];
  const add = (task, kind, details = {}) =>
    entries.push({
      id:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: now,
      taskId: task.id,
      taskName: task.name,
      project: task.project,
      members: assigneeNames(task),
      source,
      kind,
      ...details,
    });
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id),
      task = next.get(id);
    if (!old) {
      add(task, "created");
      continue;
    }
    if (!task) {
      add(old, "deleted");
      continue;
    }
    if (old.status !== task.status)
      add(task, "task_status", {
        from: old.status,
        to: task.status,
        members: [...new Set([...assigneeNames(old), ...assigneeNames(task)])],
      });
    const oldPeople = taskAssignees(old),
      people = taskAssignees(task);
    for (const member of new Set([
      ...Object.keys(oldPeople),
      ...Object.keys(people),
    ])) {
      if (oldPeople[member] === people[member]) continue;
      add(
        task,
        !Object.hasOwn(oldPeople, member)
          ? "assigned"
          : !Object.hasOwn(people, member)
            ? "unassigned"
            : "member_status",
        {
          member,
          members: [member],
          from: oldPeople[member] || "",
          to: people[member] || "",
        },
      );
    }
    const dateChanged = !same(old.start, task.start) || !same(old.end, task.end);
    if (dateChanged)
      add(task, "deadline_changed", {
        fromStart: old.start || "",
        fromEnd: old.end || "",
        toStart: task.start || "",
        toEnd: task.end || "",
      });
    const fields = ["name", "project", "description"].filter(
      (field) => !same(old[field], task[field]),
    );
    if (fields.length) add(task, "edited", { fields });
  }
  return entries;
}

// Web Locks serialize cooperating tabs. IndexedDB's read/write transaction is
// the fallback mutex; the existing localStorage payload remains the data source.
const coordinationConnections = new WeakMap();
function databaseLock(indexedDB, write) {
  let connection = coordinationConnections.get(indexedDB);
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("grad-exhibition-coordination-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("mutex");
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error(
            "다른 탭이 저장 연결을 사용 중입니다. 잠시 후 다시 시도해주세요.",
          ),
        );
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          coordinationConnections.delete(indexedDB);
        };
        resolve(database);
      };
    });
    coordinationConnections.set(indexedDB, connection);
    connection.catch(() => coordinationConnections.delete(indexedDB));
  }
  return connection.then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction("mutex", "readwrite");
        const request = transaction.objectStore("mutex").get("write");
        let result, failure;
        request.onsuccess = () => {
          try {
            result = write();
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () =>
          reject(
            failure ||
              transaction.error ||
              new Error("저장을 완료하지 못했습니다."),
          );
      }),
  );
}
export async function persistConcurrent(
  storage,
  before,
  proposed,
  environment = {},
) {
  const write = () => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null && (before.revision || environment.requireExisting)) {
      throw new ConcurrentEditError(
        "다른 탭에서 저장소가 비워졌습니다. 기존 데이터를 확인해주세요.",
        null,
      );
    }
    const latest =
      raw === null
        ? migrateState(structuredClone(DEFAULT_STATE))
        : migrateState(JSON.parse(raw));
    const merged = mergeState(before, proposed, latest);
    const additions = activityEntries(latest, merged, {
      source: environment.source || "edit",
    });
    if (environment.note) {
      const { taskId, member, text } = environment.note;
      const task = merged.tasks.find((item) => item.id === taskId);
      if (!task)
        throw new ConcurrentEditError(
          "작업이 삭제됐습니다. 기록할 작업을 다시 선택해주세요.",
          latest,
        );
      if (
        !MEMBERS.some((item) => item.name === member) ||
        !text?.trim() ||
        text.trim().length > 2000
      )
        throw new Error("팀원과 작업 내용을 확인해주세요.");
      additions.push({
        id:
          globalThis.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        at: new Date().toISOString(),
        taskId: task.id,
        taskName: task.name,
        project: task.project,
        members: [member],
        member,
        kind: "note",
        source: "note",
        text: text.trim(),
      });
    }
    merged.activity = [...(latest.activity || []), ...additions];
    persistState(storage, merged);
    return merged;
  };
  if (environment.locks?.request)
    return environment.locks.request(STORAGE_KEY, { mode: "exclusive" }, write);
  if (environment.indexedDB?.open)
    return databaseLock(environment.indexedDB, write);
  // Do not silently fall back to a read/write race in unsupported browsers.
  throw new Error(
    "이 브라우저에서는 안전하게 저장할 수 없습니다. 최신 브라우저에서 다시 시도해주세요.",
  );
}
export function taskRange(task) {
  const start = task.start || task.end || "",
    end = task.end || task.start || "";
  return start && end ? { start, end } : null;
}
export function onDate(task, date) {
  const range = taskRange(task);
  return !!range && range.start <= date && range.end >= date;
}
export function overlappingTasks(tasks, task, start = task.start, end = task.end) {
  const range = { start: start || end || "", end: end || start || "" };
  if (!range.start || !range.end) return [];
  const owners = new Set(assigneeNames(task));
  return tasks
    .filter((candidate) => {
      if (candidate.id === task.id || candidate.status === "완료") return false;
      const other = taskRange(candidate);
      return other && other.start <= range.end && other.end >= range.start;
    })
    .map((candidate) => {
      const other = taskRange(candidate);
      return {
        task: candidate,
        sameOwners: assigneeNames(candidate).filter((name) => owners.has(name)),
        overlapStart: other.start > range.start ? other.start : range.start,
        overlapEnd: other.end < range.end ? other.end : range.end,
      };
    })
    .sort((a, b) => a.overlapStart.localeCompare(b.overlapStart));
}
export function filterTasks(
  tasks,
  { project = "", owner = "", showDone = false } = {},
) {
  return tasks.filter(
    (task) =>
      (!project || task.project === project) &&
      (!owner ||
        (owner === "__none"
          ? !assigneeNames(task).length
          : assigneeNames(task).includes(owner))) &&
      (showDone || task.status !== "완료"),
  );
}
export function validateTask(task) {
  if (!task.name?.trim()) return "작업명을 입력해주세요.";
  if (!PROJECTS.some((p) => p.id === task.project))
    return "프로젝트를 선택해주세요.";
  if (
    Object.values(taskAssignees(task)).some(
      (status) => !STATUSES.includes(status),
    )
  )
    return "담당자 상태를 확인해주세요.";
  for (const date of [task.start, task.end])
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        localISO(new Date(`${date}T12:00:00`)) !== date)
    )
      return "올바른 날짜를 입력해주세요.";
  if (task.start && task.end && task.end < task.start)
    return "마감일은 시작일보다 빠를 수 없어요.";
  return "";
}
export function shiftTask(task, target, anchor) {
  const delta = dayDifference(target, anchor);
  return {
    ...task,
    start: task.start ? addDays(task.start, delta) : "",
    end: task.end ? addDays(task.end, delta) : "",
  };
}
export function monthWeeks(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const start = addDays(localISO(first), -first.getDay()),
    count = Math.ceil((first.getDay() + last.getDate()) / 7);
  return Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}
export function layoutWeek(tasks, dates, maxLanes = 3) {
  const segments = tasks
    .map((task) => ({ task, range: taskRange(task) }))
    .filter(
      ({ range }) => range && range.start <= dates[6] && range.end >= dates[0],
    )
    .map(({ task, range }) => ({
      task,
      start: dates.findIndex((d) => d >= range.start),
      end: Math.min(6, dates.filter((d) => d <= range.end).length - 1),
      continuesLeft: range.start < dates[0],
      continuesRight: range.end > dates[6],
      range,
    }));
  segments.sort(
    (a, b) =>
      a.range.start.localeCompare(b.range.start) ||
      b.end - a.end ||
      a.task.id.localeCompare(b.task.id),
  );
  const lanes = [];
  for (const segment of segments) {
    let lane = lanes.findIndex((end) => end < segment.start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = segment.end;
    segment.lane = lane;
  }
  return {
    visible: segments.filter((s) => s.lane < maxLanes),
    hidden: dates.map(
      (_, i) =>
        segments.filter((s) => s.lane >= maxLanes && s.start <= i && s.end >= i)
          .length,
    ),
    laneCount: Math.min(maxLanes, lanes.length),
  };
}
