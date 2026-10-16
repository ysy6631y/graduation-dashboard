import {
  STORAGE_KEY,
  EXHIBITION_MILESTONES,
  MEMBERS,
  taskAssignees,
  assigneeNames,
  primaryOwner,
  PROJECTS,
  STATUSES,
  loadState,
  persistState,
  persistConcurrent,
  ConcurrentEditError,
  migrateState,
  localISO,
  taskRange,
  onDate,
  filterTasks,
  validateTask,
  monthWeeks,
  layoutWeek,
  shiftTask,
  dayDifference,
} from "./core.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  calendar: "M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
  person: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  board: "M3 4h5v16H3ZM10 4h5v11h-5ZM17 4h4v14h-4Z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  check: "m5 12 4 4L19 6",
  sliders: "M4 6h16M4 18h16M8 3v6M16 15v6",
  text: "M4 5h16M4 10h16M4 15h10M4 20h7",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  external: "M14 3h7v7M21 3 11 13M10 4H4v16h16v-6",
  link: "m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
};
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.list}"/></svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
const today = localISO();
let state = { tasks: [], links: [] },
  storageBlocked = false,
  cloudClient = null,
  cloudAdapter = null,
  stopCloudSync = null;
let ui = {
  project: "",
  owner: "",
  showDone: false,
  view: "table",
  boardMode: "task",
  activityMember: "",
  activityLimit: 20,
  scope: "all",
  cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null,
};
let selectedTaskId = "",
  originalTask = "",
  originalState = null,
  newProject = "Luum",
  newAssignees = {},
  detailAssignees = {},
  linkId = "",
  originalLinkState = null,
  dragPayload = null,
  toastTimer,
  undoAction = null,
  detailDirty = false,
  createDirty = false,
  savingCount = 0,
  lastSaveError = "",
  storageWasPresent = false;
try {
  state = loadState(localStorage);
  storageWasPresent = localStorage.getItem(STORAGE_KEY) !== null;
  $("#saveIndicator").textContent = "이 브라우저에 저장";
} catch (error) {
  storageBlocked = true;
  $("#storageWarning").hidden = false;
  $("#storageWarning").textContent =
    "저장된 데이터를 불러오지 못했습니다. 원본은 유지됩니다. 브라우저 저장소를 확인해주세요.";
  $("#saveIndicator").textContent = "불러오기 실패";
  $("#saveIndicator").classList.add("error");
}
function projectInfo(project) {
  return (
    PROJECTS.find((p) => p.id === project) || {
      id: project,
      name: project,
      className: project === "공통" ? "common" : "livy",
    }
  );
}
function projectChip(project) {
  const p = projectInfo(project);
  return `<span class="project-chip ${p.className}"><span class="project-dot"></span>${esc(p.name)}</span>`;
}
function avatar(owner, status = "") {
  const member = MEMBERS.find((m) => m.name === owner);
  const label = `${owner || "담당자 미정"}${status ? " · " + status : ""}`;
  return `<span class="avatar ${member?.className || ""}" ${status ? `data-member-status="${esc(status)}"` : ""} role="img" aria-label="${esc(label)}" title="${esc(label)}">${esc(member?.initial || owner?.slice(0, 1) || "–")}</span>`;
}
function taskAvatars(task, limit = 3) {
  const assignees = taskAssignees(task),
    names = Object.keys(assignees);
  return `<span class="avatar-stack">${
    names.length
      ? names
          .slice(0, limit)
          .map((name) => avatar(name, assignees[name]))
          .join("")
      : avatar("")
  }${names.length > limit ? `<span class="avatar avatar-more" title="${esc(names.join(", "))}">+${names.length - limit}</span>` : ""}</span>`;
}
function teamProgress(task) {
  const statuses = Object.values(taskAssignees(task));
  return statuses.length > 1
    ? `<span class="team-progress" title="담당자별 완료 상태">${statuses.filter((status) => status === "완료").length}/${statuses.length} 완료</span>`
    : "";
}
function ownerLabel(task) {
  const names = assigneeNames(task);
  return `<span class="member-label" title="${esc(names.join(", "))}">${names.length > 1 ? teamProgress(task) : taskAvatars(task)}<span>${esc(names.length > 1 ? `${names[0]} 외 ${names.length - 1}명` : names[0] || "미정")}</span></span>`;
}
function dateShort(date) {
  if (!date) return "";
  const [, m, d] = date.split("-");
  return `${date.slice(0, 4) !== today.slice(0, 4) ? date.slice(0, 4) + "." : ""}${Number(m)}.${Number(d)}`;
}
function rangeText(task) {
  if (task.start && task.end && task.start !== task.end)
    return `${dateShort(task.start)} – ${dateShort(task.end)}`;
  return dateShort(task.end || task.start) || "날짜 미정";
}
function dateLabel(task) {
  const end = task.end,
    overdue = end && end < today && task.status !== "완료",
    soon =
      end &&
      dayDifference(end, today) >= 0 &&
      dayDifference(end, today) <= 2 &&
      task.status !== "완료";
  return `<span class="date-label ${overdue ? "overdue" : soon ? "soon" : !taskRange(task) ? "undated" : ""}" title="${esc(task.start || "시작일 미정")} → ${esc(task.end || "마감일 미정")}">${icon("calendar")}<span>${esc(rangeText(task))}${task.start && !task.end ? " · 마감 미정" : ""}</span>${overdue ? "<small>지남</small>" : soon ? `<small>${end === today ? "오늘" : "임박"}</small>` : ""}</span>`;
}
function statusSelect(task) {
  return `<select class="status-select" data-task-status="${esc(task.id)}" data-status="${esc(task.status)}" aria-label="${esc(task.name)} 상태">${STATUSES.map((status) => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}</select>`;
}
function toast(message, undo) {
  clearTimeout(toastTimer);
  undoAction = undo || null;
  $("#toastMessage").textContent = message;
  $("#undoButton").hidden = !undo;
  $("#toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("#toast").hidden = true;
    },
    undo ? 12000 : 4000,
  );
}
function storageError(error) {
  $("#saveIndicator").textContent = "저장 실패";
  $("#saveIndicator").classList.add("error");
  $("#storageWarning").hidden = false;
  $("#storageWarning").textContent =
    "저장하지 못했습니다. 입력 내용은 열려 있는 창에 남아 있습니다. 저장 공간과 브라우저 설정을 확인해주세요.";
  toast("저장하지 못했습니다. 다시 시도해주세요.");
}
function setSaving() {
  $$(
    'dialog input, dialog textarea, dialog select, dialog button, [data-action="create"], [data-task-status], [data-board-member-task], #worklogForm input, #worklogForm select, #worklogForm button',
  ).forEach((button) => (button.disabled = savingCount > 0));
}
async function commit(next, before = state, options = {}) {
  lastSaveError = "";
  if (storageBlocked && !cloudAdapter) {
    toast("저장소를 읽을 수 없어 변경할 수 없습니다.");
    render();
    lastSaveError = "저장소를 읽을 수 없어 변경할 수 없습니다.";
    return false;
  }
  const base = structuredClone(before),
    draft = structuredClone(next);
  savingCount++;
  $("#saveIndicator").textContent = "저장 중";
  setSaving();
  try {
    state = cloudAdapter
      ? await cloudAdapter.save(base, draft, {
          source: options.source,
          note: options.note,
        })
      : await persistConcurrent(localStorage, base, draft, {
          locks: navigator.locks,
          indexedDB: globalThis.indexedDB,
          requireExisting: storageWasPresent,
          source: options.source,
          note: options.note,
        });
    if (cloudAdapter) {
      try {
        persistState(localStorage, state);
      } catch {
        // The database is authoritative once cloud mode is active.
      }
    }
    storageWasPresent = true;
    $("#saveIndicator").textContent = cloudAdapter
      ? "팀 DB에 저장됨"
      : "이 브라우저에 저장됨";
    $("#saveIndicator").classList.remove("error");
    $("#storageWarning").hidden = true;
    render();
    return true;
  } catch (error) {
    lastSaveError =
      error instanceof ConcurrentEditError ||
      error.message?.startsWith("이 브라우저에서는")
        ? error.message
        : "저장하지 못했습니다. 입력 내용을 유지했어요.";
    if (error instanceof ConcurrentEditError) {
      if (error.latest) state = error.latest;
      else storageBlocked = true;
      $("#saveIndicator").textContent = "변경사항 충돌";
      $("#saveIndicator").classList.add("error");
      toast(lastSaveError);
    } else storageError(error);
    render();
    return false;
  } finally {
    savingCount--;
    setSaving();
  }
}
function baseTasks() {
  return filterTasks(state.tasks, ui);
}
function isTodayTask(task) {
  return (
    task.status !== "완료" &&
    (onDate(task, today) || (task.end && task.end < today))
  );
}
function listTasks() {
  return baseTasks()
    .filter((t) => ui.scope !== "today" || isTodayTask(t))
    .sort(
      (a, b) =>
        (a.status === "완료") - (b.status === "완료") ||
        (a.end || "9999").localeCompare(b.end || "9999") ||
        a.name.localeCompare(b.name),
    );
}
function renderProjectTabs() {
  const all = [{ id: "", name: "전체 프로젝트", className: "" }, ...PROJECTS];
  $("#projectTabs").innerHTML = all
    .map(
      (p) =>
        `<button class="${p.className}" data-project="${p.id}" aria-pressed="${ui.project === p.id}">${p.id ? '<span class="project-dot"></span>' : ""}${esc(p.name)}</button>`,
    )
    .join("");
}
function renderCalendar() {
  const tasks = [...baseTasks(), ...EXHIBITION_MILESTONES],
    weeks = monthWeeks(ui.cursor),
    month = ui.cursor.getMonth(),
    year = ui.cursor.getFullYear(),
    monthStart = localISO(new Date(year, month, 1)),
    monthEnd = localISO(new Date(year, month + 1, 0));
  $("#monthLabel").textContent = `${year}년 ${month + 1}월`;
  $("#calendarCount").textContent = `${
    tasks.filter((t) => {
      const r = taskRange(t);
      return r && r.start <= monthEnd && r.end >= monthStart;
    }).length
  }개`;
  $("#undatedCount").textContent = tasks.filter((t) => !taskRange(t)).length;
  $("#calendar").innerHTML =
    '<div class="weekdays">' +
    ["일", "월", "화", "수", "목", "금", "토"]
      .map((d) => `<div class="weekday">${d}</div>`)
      .join("") +
    "</div>" +
    weeks
      .map((dates) => {
        const layout = layoutWeek(tasks, dates, 3),
          lanes = Math.max(2, layout.laneCount),
          days = dates
            .map(
              (date, i) =>
                `<button class="day ${Number(date.slice(5, 7)) - 1 !== month ? "out" : ""} ${date === today ? "today" : ""} ${date === ui.selectedDate ? "selected" : ""}" data-date="${date}" aria-label="${date}, 작업 ${tasks.filter((t) => onDate(t, date)).length}개" aria-pressed="${date === ui.selectedDate}"><span class="day-number">${Number(date.slice(-2))}</span></button>`,
            )
            .join(""),
          events = layout.visible
            .map((segment) => {
              const t = segment.task,
                p = projectInfo(t.project);
              const isMilestone = t.id.startsWith("milestone-");
              return `<button class="event ${p.className} ${isMilestone ? "milestone-event" : ""} ${segment.continuesLeft ? "continues-left" : ""} ${segment.continuesRight ? "continues-right" : ""} ${t.status === "완료" ? "completed" : ""}" style="grid-column:${segment.start + 1}/span ${segment.end - segment.start + 1};grid-row:${segment.lane + 1}" ${isMilestone ? "aria-disabled=\"true\"" : `draggable="true" data-open="${esc(t.id)}" data-drag-anchor="${dates[segment.start]}"`} title="${esc(t.name)} · ${esc(p.name)} · ${esc(assigneeNames(t).join(", ") || "담당자 미정")} · ${esc(rangeText(t))}" aria-label="${esc(t.name)}, ${esc(rangeText(t))}, 담당자 ${esc(assigneeNames(t).join(", ") || "미정")}">${isMilestone ? '<span class="milestone-mark" aria-hidden="true">◆</span>' : taskAvatars(t, 2)}<span class="event-title">${esc(t.name)}</span><span class="event-project">${esc(p.name)}</span></button>`;
            })
            .join("");
        return `<div class="week" style="--lanes:${lanes + (layout.hidden.some((n) => n) ? 1 : 0)}"><div class="week-background">${days}</div><div class="week-events">${events}</div>${layout.hidden.map((n, i) => (n ? `<button class="more-button" style="left:calc(${i}*100%/7 + 8px)" data-date="${dates[i]}" aria-label="${dates[i]} 작업 ${n}개 더보기">+${n}개 더보기</button>` : "")).join("")}</div>`;
      })
      .join("");
  renderAgenda();
}
function renderAgenda() {
  const agenda = $("#dayAgenda");
  if (!ui.selectedDate) {
    agenda.hidden = true;
    return;
  }
  agenda.hidden = false;
  const undated = ui.selectedDate === "undated",
    tasks = [...baseTasks(), ...EXHIBITION_MILESTONES].filter((t) =>
      undated ? !taskRange(t) : onDate(t, ui.selectedDate),
    ),
    label = undated
      ? "날짜 미정"
      : `${Number(ui.selectedDate.slice(5, 7))}월 ${Number(ui.selectedDate.slice(-2))}일`;
  agenda.innerHTML =
    `<div class="agenda-head"><h3>${label}<span class="section-meta"> · ${tasks.length}개</span></h3><div class="filter-controls"><button class="text-button" data-action="create" ${undated ? "" : `data-create-date="${ui.selectedDate}"`}>${icon("plus")}새 작업</button><button class="icon-button" data-action="close-agenda" aria-label="날짜 작업 닫기">${icon("close")}</button></div></div>` +
    (tasks.length
      ? tasks
          .map(
            (t) =>
            `<button class="agenda-item ${t.id.startsWith("milestone-") ? "milestone-event" : ""}" ${t.id.startsWith("milestone-") ? "aria-disabled=\"true\"" : `data-open="${esc(t.id)}"`}>${t.id.startsWith("milestone-") ? '<span class="milestone-mark" aria-hidden="true">◆</span>' : taskAvatars(t)}<span class="agenda-title" title="${esc(t.name)}">${esc(t.name)}</span>${projectChip(t.project)}${dateLabel(t)}</button>`,
          )
          .join("")
      : `<div class="agenda-empty"><span>${undated ? "날짜 미정 작업이 없습니다." : "등록된 작업이 없습니다."}</span></div>`);
}
function emptyState() {
  return `<div class="empty-state">${state.tasks.length ? "조건에 맞는 작업이 없습니다." : "아직 등록된 작업이 없습니다."}<p>${state.tasks.length ? "필터를 변경하거나 새 작업을 추가하세요." : ""}</p><button class="button secondary small" data-action="create">${icon("plus")}새 작업</button></div>`;
}
function renderTasks() {
  const tasks = listTasks();
  $("#taskCount").textContent = `${tasks.length}개`;
  $("#todayCount").textContent = baseTasks().filter(isTodayTask).length;
  $("#taskRows").innerHTML = tasks.length
    ? tasks
        .map(
          (t) =>
            `<tr class="task-row ${t.status === "완료" ? "completed" : ""}" data-row="${esc(t.id)}"><td><button class="task-title-button" data-open="${esc(t.id)}" title="${esc(t.name)}">${taskAvatars(t)}<span class="task-name">${esc(t.name)}</span></button><div class="mobile-meta">${esc(assigneeNames(t).join(", ") || "담당자 미정")}<span>·</span>${projectChip(t.project)}${statusSelect(t)}</div></td><td class="mobile-date"><button class="date-edit" data-open="${esc(t.id)}" aria-label="${esc(t.name)} 기간 수정">${dateLabel(t)}</button></td><td>${ownerLabel(t)}</td><td>${projectChip(t.project)}</td><td>${statusSelect(t)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5">${emptyState()}</td></tr>`;
  renderBoard();
  $$("[data-task-status]").forEach((select) => {
    const task = state.tasks.find(
      (item) => item.id === select.dataset.taskStatus,
    );
    if (task) select.value = task.status;
  });
}
function renderBoard() {
  const memberMode = ui.boardMode === "member";
  const tasks = memberMode
    ? filterTasks(state.tasks, { ...ui, showDone: true })
    : listTasks();
  const entries = tasks
    .flatMap((task) =>
      memberMode
        ? assigneeNames(task).length
          ? Object.entries(taskAssignees(task)).map(([member, status]) => ({
              task,
              member,
              status,
            }))
          : [{ task, member: "", status: task.status }]
        : [{ task, member: "", status: task.status }],
    )
    .filter(
      (entry) =>
        (!memberMode ||
          !ui.owner ||
          ui.owner === "__none" ||
          entry.member === ui.owner) &&
        (ui.showDone || entry.status !== "완료") &&
        (!memberMode ||
          ui.scope !== "today" ||
          (entry.status !== "완료" &&
            (onDate(entry.task, today) ||
              (entry.task.end && entry.task.end < today)))),
    );
  $$("[data-board-mode]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.boardMode === ui.boardMode),
    ),
  );
  $("#board").innerHTML = STATUSES.map((status) => {
    const group = entries.filter((entry) => entry.status === status);
    const cards = group
      .map(({ task, member, status }) => {
        const personControl = member
          ? `<select class="status-select" data-board-member-task="${esc(task.id)}" data-board-member="${esc(member)}" data-status="${status}" aria-label="${esc(member)} · ${esc(task.name)} 상태">${STATUSES.map((option) => `<option ${option === status ? "selected" : ""}>${option}</option>`).join("")}</select>`
          : statusSelect(task);
        return `<article class="board-card" draggable="true" data-drag-task="${esc(task.id)}" ${member ? `data-drag-person="${esc(member)}"` : ""}><button class="task-title-button" data-open="${esc(task.id)}" title="${esc(task.name)}">${member ? avatar(member, status) : taskAvatars(task)}<span class="task-name">${esc(task.name)}</span></button>${member ? `<div class="board-person">${esc(member)}</div>` : ""}<div class="card-meta">${projectChip(task.project)}${personControl}</div><div class="card-bottom">${dateLabel(task)}${!member ? teamProgress(task) : ""}</div></article>`;
      })
      .join("");
    return `<section class="board-column" data-drop-status="${status}" aria-label="${status}"><h3 class="column-heading">${status}<span>${group.length}</span></h3>${cards || '<p class="column-empty">작업 없음</p>'}<button class="column-add" data-action="create" data-create-status="${status}">${icon("plus")}새 작업</button></section>`;
  }).join("");
  $$("[data-board-member-task]").forEach(
    (select) =>
      (select.value = taskAssignees(
        state.tasks.find((task) => task.id === select.dataset.boardMemberTask),
      )[select.dataset.boardMember]),
  );
  if (ui.view === "board" && memberMode)
    $("#taskCount").textContent =
      `${new Set(entries.map((entry) => entry.task.id)).size}개`;
}
function renderViews() {
  for (const name of ["table", "board", "activity"])
    $("#" + name + "View").hidden = ui.view !== name;
  $$("[data-view]").forEach((button) =>
    button.setAttribute(
      "aria-selected",
      String(button.dataset.view === ui.view),
    ),
  );
  $(".scope-tabs").hidden = ui.view === "activity";
}
function validURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function setCloudGate(message = "") {
  $("#main").hidden = true;
  $("#authGate").hidden = false;
  $("#loginMessage").textContent = message;
  $("#signOutButton").hidden = true;
}
async function activateCloudSession(adapter) {
  if (!cloudClient || cloudAdapter) return;
  try {
    const remote = storageBlocked
      ? await adapter.read()
      : await adapter.loadOrSeed(state);
    cloudAdapter = adapter;
    state = remote.state;
    storageBlocked = false;
    storageWasPresent = true;
    try {
      persistState(localStorage, state);
    } catch {
      // Local cache is optional in cloud mode.
    }
    $("#authGate").hidden = true;
    $("#main").hidden = false;
    $("#signOutButton").hidden = false;
    $("#saveIndicator").textContent = "팀 DB 동기화됨";
    $("#saveIndicator").classList.remove("error");
    render();
    stopCloudSync = adapter.subscribe(
      (latest) => {
        if ((latest.revision || 0) <= (state.revision || 0)) return;
        state = latest;
        try {
          persistState(localStorage, state);
        } catch {
          // Realtime data remains available from the database.
        }
        render();
        if ($("#detailDialog").open && detailDirty)
          $("#detailError").textContent =
            "팀원이 작업을 수정했습니다. 최신 내용을 확인해주세요.";
      },
      (status) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          $("#saveIndicator").textContent = "동기화 연결 확인 필요";
          $("#saveIndicator").classList.add("error");
        }
      },
    );
  } catch (error) {
    cloudAdapter = null;
    setCloudGate(
      error.message?.includes("row-level security") || error.code === "42501"
        ? "이 이메일은 팀 접근 목록에 없습니다. 관리자에게 등록을 요청해주세요."
        : `공유 DB에 연결하지 못했습니다. ${error.message || "설정을 확인해주세요."}`,
    );
  }
}
async function initializeCloud() {
  const config = window.GRAD_DASH_CONFIG;
  if (!config?.url || !config?.anonKey) return;
  setCloudGate();
  try {
    const cloud = await import("./cloud.mjs");
    cloudClient = await cloud.connectCloud(config.url, config.anonKey);
    const adapter = cloud.workspaceAdapter(cloudClient);
    cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session)
        setTimeout(() => activateCloudSession(adapter), 0);
      if (event === "SIGNED_OUT") {
        stopCloudSync?.();
        stopCloudSync = null;
        cloudAdapter = null;
        setCloudGate();
      }
    });
    const session = await cloud.activeSession(cloudClient);
    if (session) await activateCloudSession(adapter);
  } catch (error) {
    setCloudGate(`로그인 연결을 불러오지 못했습니다. ${error.message || ""}`);
  }
}
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!cloudClient) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  $("#loginMessage").textContent = "로그인 링크를 보내는 중";
  try {
    const cloud = await import("./cloud.mjs");
    const { error } = await cloud.requestMagicLink(
      cloudClient,
      $("#loginEmail").value,
    );
    if (error) throw error;
    $("#loginMessage").textContent = "메일의 로그인 링크를 확인해주세요.";
  } catch (error) {
    $("#loginMessage").textContent = error.message || "로그인 메일을 보내지 못했습니다.";
  } finally {
    button.disabled = false;
  }
});
$("#signOutButton").addEventListener("click", async () => {
  if (cloudClient) await cloudClient.auth.signOut();
});
function renderLinks() {
  $("#links").innerHTML = state.links
    .map((link) => {
      const url = validURL(link.url),
        label = projectInfo(link.label).name;
      return `<div class="resource"><p class="resource-label">${esc(label)}</p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span>${esc(link.title)}</span>${icon("external")}</a>` : `<button class="resource-open" data-link="${esc(link.id)}"><span>${esc(link.title)}</span>${icon("plus")}</button>`}${url ? `<button class="resource-edit" data-link="${esc(link.id)}">링크 수정</button>` : ""}</div>`;
    })
    .join("");
}
function activityText(entry) {
  if (entry.kind === "note") return entry.text || "";
  if (entry.kind === "member_status")
    return `개인 상태 · ${entry.from} → ${entry.to}`;
  if (entry.kind === "task_status")
    return `전체 상태 · ${entry.from} → ${entry.to}`;
  if (entry.kind === "created") return "작업 등록";
  if (entry.kind === "deleted") return "작업 삭제";
  if (entry.kind === "assigned") return "담당자 추가";
  if (entry.kind === "unassigned") return "담당 해제";
  const labels = {
    name: "작업명",
    project: "프로젝트",
    start: "시작일",
    end: "마감일",
    description: "메모",
  };
  return `${(entry.fields || []).map((field) => labels[field] || field).join(" · ")} 수정`;
}
function renderActivity() {
  $("#activityMembers").innerHTML =
    `<button data-activity-member="" aria-pressed="${!ui.activityMember}">전체</button>` +
    MEMBERS.map(
      (member) =>
        `<button data-activity-member="${member.name}" aria-pressed="${ui.activityMember === member.name}">${avatar(member.name)}${member.name}</button>`,
    ).join("");
  const selectedTask = $("#noteTask").value;
  $("#noteTask").innerHTML =
    '<option value="">작업 선택</option>' +
    state.tasks
      .map(
        (task) => `<option value="${esc(task.id)}">${esc(task.name)}</option>`,
      )
      .join("");
  if (state.tasks.some((task) => task.id === selectedTask))
    $("#noteTask").value = selectedTask;
  const records = (state.activity || [])
    .filter(
      (entry) =>
        (!ui.activityMember ||
          (entry.members || []).includes(ui.activityMember)) &&
        (!ui.project || entry.project === ui.project),
    )
    .slice()
    .reverse();
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  $("#activityList").innerHTML = records.length
    ? records
        .slice(0, ui.activityLimit)
        .map((entry) => {
          const taskExists = state.tasks.some(
            (task) => task.id === entry.taskId,
          );
          const people = entry.member ? [entry.member] : entry.members || [];
          const person =
            people.length === 1
              ? ownerNameLabel(people[0])
              : `<span class="activity-shared">${people.length ? esc(people.join(", ")) : "담당자 미정"}</span>`;
          const time = Number.isNaN(Date.parse(entry.at))
            ? ""
            : formatter.format(new Date(entry.at));
          return `<article class="activity-entry" data-activity-id="${esc(entry.id)}"><div class="activity-entry-head">${person}<time datetime="${esc(entry.at || "")}">${esc(time)}</time>${entry.source === "undo" ? '<span class="undo-badge">되돌림</span>' : ""}</div>${taskExists ? `<button class="activity-task" data-open="${esc(entry.taskId)}">${esc(entry.taskName)}</button>` : `<span class="activity-task deleted">${esc(entry.taskName)} · 삭제된 작업</span>`}<p class="activity-content">${esc(activityText(entry))}</p></article>`;
        })
        .join("")
    : '<div class="activity-empty">아직 기록이 없습니다.</div>';
  $("#activityMore").hidden = records.length <= ui.activityLimit;
}
function render() {
  renderProjectTabs();
  renderCalendar();
  renderTasks();
  renderLinks();
  renderActivity();
  renderViews();
  setSaving();
}
function ownerChoices(target, value) {
  $(target).innerHTML =
    `<button class="owner-option" type="button" data-owner="" aria-pressed="${!Object.keys(value).length}">미정</button>` +
    MEMBERS.map(
      (m) =>
        `<button class="owner-option" type="button" data-owner="${m.name}" aria-pressed="${Object.hasOwn(value, m.name)}">${avatar(m.name)}${m.name}</button>`,
    ).join("");
  const context = target === "#newOwners" ? "new" : "detail";
  $(`#${context}AssigneeStatuses`).innerHTML = Object.entries(value)
    .map(
      ([name, status]) =>
        `<label class="assignee-status-row">${ownerNameLabel(name)}<select class="status-select" data-assignee-status="${esc(name)}" data-assignee-context="${context}" data-status="${esc(status)}" aria-label="${esc(name)} 진행 상태">${STATUSES.map((option) => `<option ${option === status ? "selected" : ""}>${option}</option>`).join("")}</select></label>`,
    )
    .join("");
  $$(`#${context}AssigneeStatuses select`).forEach(
    (select) => (select.value = value[select.dataset.assigneeStatus]),
  );
}
function ownerNameLabel(name) {
  return `<span class="member-label">${avatar(name)}<span>${esc(name)}</span></span>`;
}
function showCreate({ date = "", status = "진행 중" } = {}) {
  $("#createForm").reset();
  newProject = ui.project || "Luum";
  newAssignees =
    ui.owner && ui.owner !== "__none" ? { [ui.owner]: "진행 중" } : {};
  createDirty = false;
  $("#newStart").value = date;
  $("#newEnd").value = date;
  $("#newStatus").value = status;
  $("#newExtras").hidden =
    !date && !Object.keys(newAssignees).length && status === "진행 중";
  $("#expandCreate").setAttribute(
    "aria-expanded",
    String(!$("#newExtras").hidden),
  );
  $("#createError").textContent = "";
  renderNewProjects();
  ownerChoices("#newOwners", newAssignees);
  $("#createDialog").showModal();
  $("#newName").focus();
}
function renderNewProjects() {
  $("#newProjectChoices").innerHTML = PROJECTS.map(
    (p) =>
      `<button class="project-choice ${p.className}" type="button" data-new-project="${p.id}" aria-pressed="${newProject === p.id}"><span class="project-dot"></span>${p.name}</button>`,
  ).join("");
}
function showDetail(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  selectedTaskId = id;
  originalTask = JSON.stringify(task);
  originalState = structuredClone(state);
  detailDirty = false;
  detailAssignees = taskAssignees(task);
  $("#detailName").value = task.name;
  $("#detailProject").value = task.project;
  $("#detailStatus").value = task.status;
  $("#detailStart").value = task.start || "";
  $("#detailEnd").value = task.end || "";
  $("#detailDescription").value = task.description || "";
  ownerChoices("#detailOwners", detailAssignees);
  $("#detailError").textContent = "";
  $("#detailDialog").showModal();
  $("#detailName").focus();
}
function closeDialog(id) {
  if (savingCount) return;
  const dirty =
    id === "detailDialog"
      ? detailDirty
      : id === "createDialog"
        ? createDirty
        : false;
  if (dirty && !confirm("저장하지 않은 변경사항을 닫을까요?")) return;
  $("#" + id).close();
}
function revealTask(task) {
  if (ui.project && ui.project !== task.project) ui.project = task.project;
  if (ui.owner && !assigneeNames(task).includes(ui.owner)) {
    ui.owner = "";
    $("#ownerFilter").value = "";
  }
  if (task.status === "완료") {
    ui.showDone = true;
    $("#showDone").checked = true;
  }
  ui.scope = "all";
  $$("[data-scope]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.scope === "all")),
  );
  const range = taskRange(task);
  if (range) {
    ui.cursor = new Date(`${range.start}T12:00:00`);
    ui.cursor.setDate(1);
    ui.selectedDate = range.start;
  } else ui.selectedDate = "undated";
}
function undoChanges(before, proposed) {
  return async () => {
    if (await commit(before, proposed, { source: "undo" }))
      toast("되돌렸습니다.");
  };
}
function revealStateChange(
  task,
  { member = "", status = "", mode = "task" } = {},
) {
  task = state.tasks.find((item) => item.id === task.id) || task;
  ui.boardMode = mode;
  if (ui.project && ui.project !== task.project) ui.project = task.project;
  if (member && ui.owner && ui.owner !== member) {
    ui.owner = "";
    $("#ownerFilter").value = "";
  }
  if (member && ui.view === "activity") {
    ui.activityMember = member;
    ui.activityLimit = 20;
    $("#noteMember").value = member;
  }
  if (status === "완료") {
    ui.showDone = true;
    $("#showDone").checked = true;
  }
  if (ui.scope === "today") {
    ui.scope = "all";
    $$("[data-scope]").forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scope === "all"),
      ),
    );
  }
  render();
}
async function updateTask(id, patch, message) {
  const before = state.tasks.find((t) => t.id === id);
  if (!before) return;
  const next = { ...before, ...patch },
    error = validateTask(next);
  if (error) {
    toast(error);
    return;
  }
  const base = state;
  const draft = {
    ...base,
    tasks: base.tasks.map((t) => (t.id === id ? next : t)),
  };
  if (await commit(draft, base)) {
    if (patch.status) revealStateChange(next, { status: patch.status });
    if (patch.status === "완료")
      $$("[data-row]")
        .find((row) => row.dataset.row === id)
        ?.classList.add("just-completed");
    toast(message, undoChanges(base, draft));
  }
}
$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingCount) return;
  const task = {
    id:
      globalThis.crypto?.randomUUID?.() ||
      `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: $("#newName").value.trim(),
    project: newProject,
    status: $("#newStatus").value,
    owner: primaryOwner(newAssignees),
    assignees: { ...newAssignees },
    start: $("#newStart").value,
    end: $("#newEnd").value,
    description: "",
  };
  const error = validateTask(task);
  if (error) {
    $("#createError").textContent = error;
    return;
  }
  const previousUI = { ...ui };
  revealTask(task);
  if (await commit({ ...state, tasks: [...state.tasks, task] })) {
    createDirty = false;
    $("#createDialog").close();
    toast("작업을 추가했습니다.");
  } else {
    ui = previousUI;
    $("#ownerFilter").value = ui.owner;
    $("#showDone").checked = ui.showDone;
    render();
    $("#createError").textContent =
      lastSaveError || "저장하지 못했습니다. 입력 내용을 유지했어요.";
  }
});
async function updateMemberStatus(id, member, status) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !Object.hasOwn(taskAssignees(task), member)) return;
  const base = state,
    draft = {
      ...base,
      tasks: base.tasks.map((item) =>
        item.id === id
          ? { ...item, assignees: { ...taskAssignees(item), [member]: status } }
          : item,
      ),
    };
  if (await commit(draft, base)) {
    revealStateChange(task, { member, status, mode: "member" });
    toast(`${member} · ${status}`, undoChanges(base, draft));
  }
}
$("#detailForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingCount) return;
  const current = state.tasks.find((t) => t.id === selectedTaskId);
  if (!current) {
    $("#detailError").textContent = "다른 창에서 삭제된 작업입니다.";
    return;
  }
  const original = JSON.parse(originalTask);
  const task = {
    ...original,
    name: $("#detailName").value.trim(),
    project: $("#detailProject").value,
    status: $("#detailStatus").value,
    owner: primaryOwner(detailAssignees),
    assignees: { ...detailAssignees },
    start: $("#detailStart").value,
    end: $("#detailEnd").value,
    description: $("#detailDescription").value,
  };
  const error = validateTask(task);
  if (error) {
    $("#detailError").textContent = error;
    return;
  }
  const becameComplete = current.status !== "완료" && task.status === "완료";
  const draft = {
    ...originalState,
    tasks: originalState.tasks.map((t) => (t.id === task.id ? task : t)),
  };
  if (await commit(draft, originalState)) {
    if (original.status !== task.status)
      revealStateChange(task, { status: task.status });
    else if (
      JSON.stringify(taskAssignees(original)) !== JSON.stringify(task.assignees)
    ) {
      const newlyCompleted = Object.keys(task.assignees).some(
        (name) =>
          task.assignees[name] === "완료" &&
          taskAssignees(original)[name] !== "완료",
      );
      const member =
        Object.keys(task.assignees).find(
          (name) => task.assignees[name] !== taskAssignees(original)[name],
        ) || "";
      revealStateChange(task, {
        mode: "member",
        member,
        status: newlyCompleted ? "완료" : "",
      });
    }
    detailDirty = false;
    $("#detailDialog").close();
    toast(
      becameComplete ? "완료로 변경했습니다." : "변경사항을 저장했습니다.",
      undoChanges(originalState, draft),
    );
  } else
    $("#detailError").textContent =
      lastSaveError || "저장하지 못했습니다. 입력 내용을 유지했어요.";
});
$("#deleteTask").addEventListener("click", async () => {
  if (savingCount) return;
  const task = state.tasks.find((t) => t.id === selectedTaskId);
  if (!task) return;
  const base = originalState,
    draft = { ...base, tasks: base.tasks.filter((t) => t.id !== task.id) };
  if (await commit(draft, base)) {
    detailDirty = false;
    $("#detailDialog").close();
    toast("작업을 삭제했습니다.", undoChanges(base, draft));
  }
});
document.addEventListener("click", (event) => {
  const target = event.target.closest("button,a");
  if (!target) return;
  if (target.dataset.action === "create")
    showCreate({
      date: target.dataset.createDate || "",
      status: target.dataset.createStatus || "진행 중",
    });
  if (target.dataset.open) showDetail(target.dataset.open);
  if (target.dataset.date) {
    ui.selectedDate = target.dataset.date;
    renderCalendar();
  }
  if (target.dataset.action === "close-agenda") {
    ui.selectedDate = null;
    renderCalendar();
  }
  if (target.dataset.close) closeDialog(target.dataset.close);
  if (target.dataset.project !== undefined) {
    ui.project = target.dataset.project;
    render();
  }
  if (target.dataset.newProject) {
    newProject = target.dataset.newProject;
    createDirty = true;
    renderNewProjects();
    $(`[data-new-project="${newProject}"]`).focus();
  }
  if (target.dataset.owner !== undefined) {
    if (target.closest("#newOwners")) {
      const name = target.dataset.owner;
      if (!name) newAssignees = {};
      else if (Object.hasOwn(newAssignees, name)) delete newAssignees[name];
      else newAssignees[name] = "진행 중";
      createDirty = true;
      ownerChoices("#newOwners", newAssignees);
      $(`#newOwners [data-owner="${name}"]`).focus();
    } else if (target.closest("#detailOwners")) {
      const name = target.dataset.owner;
      if (!name) detailAssignees = {};
      else if (Object.hasOwn(detailAssignees, name))
        delete detailAssignees[name];
      else detailAssignees[name] = "진행 중";
      detailDirty = true;
      ownerChoices("#detailOwners", detailAssignees);
      $(`#detailOwners [data-owner="${name}"]`).focus();
    }
  }
  if (target.dataset.view) {
    ui.view = target.dataset.view;
    renderViews();
    renderTasks();
    if (ui.view === "activity") renderActivity();
  }
  if (target.dataset.boardMode) {
    ui.boardMode = target.dataset.boardMode;
    renderTasks();
  }
  if (target.dataset.activityMember !== undefined) {
    ui.activityMember = target.dataset.activityMember;
    ui.activityLimit = 20;
    $("#noteMember").value = ui.activityMember;
    renderActivity();
  }
  if (target.dataset.scope) {
    ui.scope = target.dataset.scope;
    $$("[data-scope]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.scope === ui.scope)),
    );
    renderTasks();
  }
  if (target.dataset.link) {
    const link = state.links.find((l) => l.id === target.dataset.link);
    if (link) {
      linkId = link.id;
      originalLinkState = structuredClone(state);
      $("#linkTitle").textContent = link.title;
      $("#linkUrl").value = link.url || "";
      $("#linkError").textContent = "";
      $("#linkDialog").showModal();
    }
  }
});
$("#ownerFilter").addEventListener("change", (event) => {
  ui.owner = event.target.value;
  render();
});
$("#showDone").addEventListener("change", (event) => {
  ui.showDone = event.target.checked;
  render();
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.boardMemberTask)
    updateMemberStatus(
      el.dataset.boardMemberTask,
      el.dataset.boardMember,
      el.value,
    );
  if (el.dataset.assigneeStatus) {
    const name = el.dataset.assigneeStatus;
    if (el.dataset.assigneeContext === "new") {
      newAssignees[name] = el.value;
      createDirty = true;
    } else {
      detailAssignees[name] = el.value;
      detailDirty = true;
    }
    el.dataset.status = el.value;
  }
  if (el.dataset.taskStatus)
    updateTask(
      el.dataset.taskStatus,
      { status: el.value },
      el.value === "완료" ? "완료로 변경했습니다." : "상태를 변경했습니다.",
    );
});
$("#expandCreate").addEventListener("click", () => {
  const expanded = $("#newExtras").hidden;
  $("#newExtras").hidden = !expanded;
  $("#expandCreate").setAttribute("aria-expanded", String(expanded));
});
$("#activityMore").onclick = () => {
  ui.activityLimit += 20;
  renderActivity();
};
$("#worklogForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingCount) return;
  const note = {
    member: $("#noteMember").value,
    taskId: $("#noteTask").value,
    text: $("#noteText").value.trim(),
  };
  if (!note.member || !note.taskId || !note.text) {
    $("#worklogError").textContent = "팀원, 작업, 내용을 입력해주세요.";
    return;
  }
  if (await commit(state, state, { note })) {
    ui.activityMember = note.member;
    ui.activityLimit = 20;
    const task = state.tasks.find((item) => item.id === note.taskId);
    if (ui.project && task && ui.project !== task.project)
      ui.project = task.project;
    $("#noteText").value = "";
    $("#worklogError").textContent = "";
    render();
    toast("작업 기록을 남겼습니다.");
  } else $("#worklogError").textContent = lastSaveError;
});
$("#createForm").addEventListener("input", () => (createDirty = true));
$("#detailForm").addEventListener("input", () => (detailDirty = true));
$("#detailForm").addEventListener("change", () => (detailDirty = true));
$("#taskRows").addEventListener("click", (event) => {
  if (event.target.closest("button,select,a,input")) return;
  const row = event.target.closest("[data-row]");
  if (row) showDetail(row.dataset.row);
});
window.addEventListener("beforeunload", (event) => {
  if (
    savingCount ||
    $("#noteText").value.trim() ||
    ($("#detailDialog").open && detailDirty) ||
    ($("#createDialog").open && createDirty)
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
["createDialog", "detailDialog", "linkDialog"].forEach((id) =>
  $("#" + id).addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(id);
  }),
);
$("#prevMonth").onclick = () => {
  ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() - 1, 1);
  ui.selectedDate = null;
  renderCalendar();
};
$("#nextMonth").onclick = () => {
  ui.cursor = new Date(ui.cursor.getFullYear(), ui.cursor.getMonth() + 1, 1);
  ui.selectedDate = null;
  renderCalendar();
};
$("#todayButton").onclick = () => {
  ui.cursor = new Date();
  ui.cursor.setDate(1);
  ui.selectedDate = today;
  renderCalendar();
};
$("#undatedButton").onclick = () => {
  ui.selectedDate = ui.selectedDate === "undated" ? null : "undated";
  renderAgenda();
};
$("#undoButton").onclick = async () => {
  if (savingCount) return;
  const undo = undoAction;
  undoAction = null;
  if (undo) await undo();
};
$("#toastClose").onclick = () => {
  $("#toast").hidden = true;
  clearTimeout(toastTimer);
};
$("#linkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingCount) return;
  const url = validURL($("#linkUrl").value.trim());
  if (!url) {
    $("#linkError").textContent = "http 또는 https 링크를 입력해주세요.";
    return;
  }
  if (
    await commit(
      {
        ...originalLinkState,
        links: originalLinkState.links.map((l) =>
          l.id === linkId ? { ...l, url } : l,
        ),
      },
      originalLinkState,
    )
  ) {
    $("#linkDialog").close();
    toast("링크를 저장했습니다.");
  } else
    $("#linkError").textContent =
      lastSaveError || "저장하지 못했습니다. 다시 시도해주세요.";
});
document.addEventListener("dragstart", (event) => {
  const el = event.target.closest("[data-drag-task],[data-drag-anchor]");
  if (!el) return;
  dragPayload = {
    id: el.dataset.dragTask || el.dataset.open,
    anchor: el.dataset.dragAnchor || null,
    member: el.dataset.dragPerson || "",
  };
  event.dataTransfer.setData("text/plain", JSON.stringify(dragPayload));
  event.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", (event) => {
  const drop = event.target.closest(".day,[data-drop-status]");
  if (!drop || !dragPayload) return;
  event.preventDefault();
  drop.classList.add("drag-over");
});
document.addEventListener("dragleave", (event) => {
  event.target
    .closest(".day,[data-drop-status]")
    ?.classList.remove("drag-over");
});
document.addEventListener("dragend", () => {
  dragPayload = null;
  $$(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});
document.addEventListener("drop", (event) => {
  const drop = event.target.closest(".day,[data-drop-status]");
  if (!drop || !dragPayload) return;
  event.preventDefault();
  const task = state.tasks.find((t) => t.id === dragPayload.id);
  if (!task) return;
  if (drop.dataset.dropStatus && dragPayload.member)
    updateMemberStatus(task.id, dragPayload.member, drop.dataset.dropStatus);
  else if (drop.dataset.dropStatus)
    updateTask(
      task.id,
      { status: drop.dataset.dropStatus },
      "상태를 변경했습니다.",
    );
  else if (drop.dataset.date) {
    const range = taskRange(task),
      shifted = range
        ? shiftTask(task, drop.dataset.date, dragPayload.anchor || range.start)
        : { start: drop.dataset.date, end: drop.dataset.date };
    updateTask(
      task.id,
      { start: shifted.start, end: shifted.end },
      "일정을 이동했습니다.",
    );
  }
  dragPayload = null;
  $$(".drag-over").forEach((el) => el.classList.remove("drag-over"));
});
window.addEventListener("storage", (event) => {
  if (cloudAdapter || event.key !== STORAGE_KEY) return;
  const latestRaw = localStorage.getItem(STORAGE_KEY);
  if (latestRaw === null) {
    storageBlocked = true;
    $("#storageWarning").hidden = false;
    $("#storageWarning").textContent =
      "다른 창에서 브라우저 저장소가 비워졌습니다. 현재 화면의 작업은 유지됩니다.";
    return;
  }
  try {
    state = migrateState(JSON.parse(latestRaw));
    storageBlocked = false;
    storageWasPresent = true;
    render();
    if ($("#detailDialog").open && detailDirty)
      $("#detailError").textContent =
        "다른 창에서 작업이 변경됐습니다. 저장 전 최신 내용을 확인해주세요.";
  } catch {
    toast("다른 창의 저장 데이터를 읽지 못했습니다.");
  }
});
// Arrow keys switch views; native dialogs provide focus trapping and Escape support.
$(".view-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const tabs = $$("[data-view]"),
    index = tabs.findIndex((button) => button.dataset.view === ui.view),
    next =
      tabs[
        (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
          tabs.length
      ];
  next.click();
  next.focus();
});
hydrateIcons();
render();
void initializeCloud();
