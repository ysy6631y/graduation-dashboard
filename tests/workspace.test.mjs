import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../dist/core.mjs";
import { boot, submit, stored, create, settle } from "./helpers.mjs";

const legacy = {
  tasks: [
    {
      id: "original",
      name: "기존 작업",
      project: "LivyDuvy",
      status: "확인 필요",
      owner: "윤서영",
      due: "2026-10-18",
      description: "유지할 메모",
      customProperty: "keep-me",
    },
  ],
  links: [
    {
      id: "team-link",
      label: "공통",
      title: "기존 자료",
      url: "https://example.com/team",
    },
  ],
  extra: "keep-root",
};
test("legacy data is read without overwriting; first write preserves a complete backup and unrelated fields", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    assert.equal(
      window.localStorage.getItem(core.STORAGE_KEY),
      JSON.stringify(legacy),
    );
    assert.match(doc.querySelector("#taskRows").textContent, /기존 작업/);
    await create(window);
    const saved = stored(window);
    assert.equal(saved.extra, "keep-root");
    assert.equal(
      saved.tasks.find((t) => t.id === "original").customProperty,
      "keep-me",
    );
    assert.equal(
      saved.tasks.find((t) => t.id === "original").end,
      "2026-10-18",
    );
    assert.deepEqual(saved.links, legacy.links);
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem(core.BACKUP_KEY)),
      legacy,
    );
  } finally {
    await close();
  }
});
test("plus button opens capture; title/project alone creates an undated task; all four owners are available", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    doc.querySelector(".add-row").click();
    await settle();
    assert.equal(doc.querySelector("#createDialog").open, true);
    assert.equal(doc.querySelector("#newExtras").hidden, true);
    assert.equal(doc.querySelectorAll("#newOwners [data-owner]").length, 5);
    doc.querySelector("#newName").value = "빠른 기록";
    await submit(window, "#createForm");
    assert.equal(doc.querySelector("#createDialog").open, false);
    const task = stored(window).tasks.find((t) => t.name === "빠른 기록");
    assert.equal(task.start, "");
    assert.equal(task.end, "");
    assert.match(doc.querySelector("#taskRows").textContent, /빠른 기록/);
    assert.match(doc.querySelector("#dayAgenda").textContent, /날짜 미정/);
  } finally {
    await close();
  }
});
test("created range appears as one bar per week; detail edits update list and calendar together", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    const task = await create(window);
    assert.equal(
      doc.querySelectorAll(`.event[data-open="${task.id}"]`).length,
      2,
    );
    assert.match(
      doc.querySelector(`.event[data-open="${task.id}"]`).getAttribute("style"),
      /span 5/,
    );
    assert.match(doc.querySelector("#taskRows").textContent, /10.13 – 10.19/);
    doc.querySelector(`.task-title-button[data-open="${task.id}"]`).click();
    await settle();
    assert.equal(doc.querySelector("#detailDialog").open, true);
    doc.querySelector("#detailName").value = "수정한 작업";
    doc.querySelector("#detailStart").value = "2026-10-21";
    doc.querySelector("#detailEnd").value = "2026-10-30";
    doc.querySelector('#detailOwners [data-owner="임다혜"]').click();
    doc.querySelector('#detailOwners [data-owner="강주원"]').click();
    await settle();
    await submit(window, "#detailForm");
    assert.equal(doc.querySelector("#detailDialog").open, false);
    assert.match(doc.querySelector("#taskRows").textContent, /수정한 작업/);
    assert.match(doc.querySelector("#taskRows").textContent, /10.21 – 10.30/);
    assert.match(
      doc
        .querySelector(`.event[data-open="${task.id}"]`)
        .getAttribute("aria-label"),
      /강주원/,
    );
    const saved = stored(window).tasks.find((t) => t.id === task.id);
    assert.equal(saved.owner, "강주원");
    assert.equal(saved.end, "2026-10-30");
  } finally {
    await close();
  }
});

test("exhibition milestones appear on the correct calendar dates and multi-day exhibition spans weeks", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    assert.equal(
      doc.querySelectorAll('.event[aria-label^="2차 졸전 심사"]').length,
      1,
    );
    doc.querySelector('[data-date="2026-10-21"]').click();
    assert.match(doc.querySelector("#dayAgenda").textContent, /2차 졸전 심사/);

    doc.querySelector("#nextMonth").click();
    assert.equal(
      doc.querySelectorAll('.event[aria-label^="졸업전시"]').length,
      2,
    );
    doc.querySelector('[data-date="2026-11-09"]').click();
    assert.match(doc.querySelector("#dayAgenda").textContent, /졸업전시/);
    assert.match(doc.querySelector("#calendarCount").textContent, /1개/);
  } finally {
    await close();
  }
});
test("completion synchronizes all views and can be undone; project and owner filters apply to calendar too", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    const task = await create(window);
    const select = doc.querySelector(`[data-task-status="${task.id}"]`);
    select.value = "완료";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    assert.ok(doc.querySelector(`.event.completed[data-open="${task.id}"]`));
    assert.ok(doc.querySelector(`[data-row="${task.id}"].completed`));
    assert.equal(doc.querySelector("#showDone").checked, true);
    doc.querySelector("#showDone").checked = false;
    doc
      .querySelector("#showDone")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(doc.querySelector(`.event[data-open="${task.id}"]`), null);
    assert.equal(doc.querySelector(`[data-row="${task.id}"]`), null);
    doc.querySelector("#undoButton").click();
    await settle();
    assert.ok(doc.querySelector(`.event[data-open="${task.id}"]`));
    doc.querySelector('[data-project="LivyDuvy"]').click();
    await settle();
    assert.equal(doc.querySelector(`.event[data-open="${task.id}"]`), null);
    assert.ok(doc.querySelector('[data-row="original"]'));
    doc.querySelector('[data-project=""]').click();
    await settle();
    doc.querySelector("#ownerFilter").value = "임다혜";
    doc
      .querySelector("#ownerFilter")
      .dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(doc.querySelector('[data-row="original"]'), null);
    assert.ok(doc.querySelector(`.event[data-open="${task.id}"]`));
  } finally {
    await close();
  }
});
test("saved task is restored on reload and no example rows are added to an existing empty workspace", async () => {
  let env = boot(legacy);
  let raw, id;
  try {
    id = (await create(env.window)).id;
    raw = env.window.localStorage.getItem(core.STORAGE_KEY);
  } finally {
    await env.close();
  }
  env = boot(raw);
  try {
    assert.ok(env.doc.querySelector(`[data-row="${id}"]`));
    assert.equal(stored(env.window).tasks.length, 2);
  } finally {
    await env.close();
  }
  env = boot({ tasks: [], links: [] });
  try {
    assert.equal(env.doc.querySelectorAll("[data-row]").length, 0);
    assert.equal(
      env.window.localStorage.getItem(core.STORAGE_KEY),
      JSON.stringify({ tasks: [], links: [] }),
    );
  } finally {
    await env.close();
  }
});
test("invalid range and storage failure keep the form open and original data untouched", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    doc.querySelector(".add-row").click();
    await settle();
    doc.querySelector("#newName").value = "오류 시 보존";
    doc.querySelector("#newStart").value = "2026-10-20";
    doc.querySelector("#newEnd").value = "2026-10-10";
    await submit(window, "#createForm");
    assert.match(doc.querySelector("#createError").textContent, /빠를 수/);
    assert.equal(doc.querySelector("#createDialog").open, true);
    assert.equal(stored(window).tasks.length, 1);
    doc.querySelector("#newEnd").value = "2026-10-21";
    const actualStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: actualStorage.getItem.bind(actualStorage),
        setItem() {
          throw new Error("QuotaExceededError");
        },
      },
    });
    await submit(window, "#createForm");
    assert.equal(doc.querySelector("#createDialog").open, true);
    assert.equal(doc.querySelector("#newName").value, "오류 시 보존");
    assert.equal(stored(window).tasks.length, 1);
    assert.match(doc.querySelector("#createError").textContent, /저장하지 못/);
  } finally {
    await close();
  }
});
test("corrupt storage is never replaced with defaults", async () => {
  const { window, doc, close } = boot("{invalid-json");
  try {
    assert.equal(
      window.localStorage.getItem(core.STORAGE_KEY),
      "{invalid-json",
    );
    assert.equal(doc.querySelector("#storageWarning").hidden, false);
    doc.querySelector(".add-row").click();
    await settle();
    doc.querySelector("#newName").value = "저장 불가";
    await submit(window, "#createForm");
    assert.equal(
      window.localStorage.getItem(core.STORAGE_KEY),
      "{invalid-json",
    );
  } finally {
    await close();
  }
});
test("calendar packing: long overlaps have stable lanes, overflow counts are accurate, month/week boundaries continue", () => {
  const dates = [
    "2026-10-11",
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
  ];
  const tasks = Array.from({ length: 7 }, (_, i) => ({
    id: `task-${i}`,
    start: i === 0 ? "2026-09-28" : "2026-10-13",
    end: i === 0 ? "2026-11-03" : "2026-10-17",
  }));
  const layout = core.layoutWeek(tasks, dates, 3);
  assert.equal(layout.visible.length, 3);
  assert.deepEqual(layout.hidden, [0, 0, 4, 4, 4, 4, 4]);
  assert.equal(layout.visible[0].continuesLeft, true);
  assert.equal(layout.visible[0].continuesRight, true);
  for (let day = 0; day < 7; day++) {
    const visible = layout.visible.filter(
      (s) => s.start <= day && s.end >= day,
    );
    assert.equal(new Set(visible.map((s) => s.lane)).size, visible.length);
  }
  const shifted = core.shiftTask(tasks[0], "2026-10-13", "2026-10-11");
  assert.equal(shifted.start, "2026-09-30");
  assert.equal(shifted.end, "2026-11-05");
});
test("long user text is rendered as text and resource URLs reject executable schemes", async () => {
  const seeded = structuredClone(legacy);
  seeded.tasks[0].name = "<img src=x onerror=alert(1)> 긴 제목";
  seeded.links[0].url = "javascript:alert(1)";
  const { doc, close } = boot(seeded);
  try {
    assert.equal(doc.querySelectorAll("img").length, 0);
    assert.match(doc.querySelector(".task-title-button").textContent, /<img/);
    assert.equal(doc.querySelector(".resource a"), null);
  } finally {
    await close();
  }
});
test("overflow opens the selected day with all tasks, including items hidden behind more", async () => {
  const seed = structuredClone(legacy);
  seed.tasks = Array.from({ length: 8 }, (_, i) => ({
    id: `dense-${i}`,
    name: `일정 ${i}`,
    project: i % 2 ? "Luum" : "LivyDuvy",
    status: "진행 중",
    owner: "이유진",
    start: core.localISO(),
    end: core.localISO(),
  }));
  const { window, doc, close } = boot(seed);
  try {
    assert.equal(doc.querySelectorAll(".event[data-open]").length, 3);
    assert.equal(doc.querySelectorAll(".event.milestone-event").length, 1);
    const more = [...doc.querySelectorAll(".more-button")].find(
      (button) => button.dataset.date === core.localISO(),
    );
    assert.match(more.textContent, /5개 더보기/);
    more.click();
    await settle();
    assert.equal(doc.querySelectorAll(".agenda-item[data-open]").length, 8);
    doc.querySelector(".agenda-item[data-open]").click();
    await settle();
    assert.equal(doc.querySelector("#detailDialog").open, true);
  } finally {
    await close();
  }
});
test("calendar drag moves the full duration and board drag changes status; both have edit controls", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    const task = await create(window);
    async function drag(from, to) {
      const event = new window.Event("dragstart", { bubbles: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { setData() {}, effectAllowed: "" },
      });
      from.dispatchEvent(event);
      to.dispatchEvent(
        new window.Event("drop", { bubbles: true, cancelable: true }),
      );
      await settle();
    }
    await drag(
      doc.querySelector(`.event[data-open="${task.id}"]`),
      doc.querySelector('.day[data-date="2026-10-16"]'),
    );
    let moved = stored(window).tasks.find((t) => t.id === task.id);
    assert.equal(moved.start, "2026-10-16");
    assert.equal(moved.end, "2026-10-22");
    doc.querySelector('[data-view="board"]').click();
    await settle();
    assert.equal(doc.querySelector("#boardView").hidden, false);
    await drag(
      doc.querySelector(`[data-drag-task="${task.id}"]`),
      doc.querySelector('[data-drop-status="확인 필요"]'),
    );
    moved = stored(window).tasks.find((t) => t.id === task.id);
    assert.equal(moved.status, "확인 필요");
    assert.ok(doc.querySelector(`[data-task-status="${task.id}"]`));
    doc.querySelector(`.event[data-open="${task.id}"]`).click();
    await settle();
    assert.equal(doc.querySelector("#detailStart").value, "2026-10-16");
  } finally {
    await close();
  }
});
test("deletion can be restored without losing fields; existing resource links remain editable", async () => {
  const { window, doc, close } = boot(legacy);
  try {
    doc.querySelector('[data-open="original"]').click();
    await settle();
    doc.querySelector("#deleteTask").click();
    await settle();
    assert.equal(stored(window).tasks.length, 0);
    doc.querySelector("#undoButton").click();
    await settle();
    assert.equal(stored(window).tasks[0].customProperty, "keep-me");
    doc.querySelector('[data-link="team-link"]').click();
    await settle();
    doc.querySelector("#linkUrl").value = "https://example.com/new";
    await submit(window, "#linkForm");
    assert.equal(stored(window).links[0].url, "https://example.com/new");
    assert.equal(
      doc.querySelector(".resource a").href,
      "https://example.com/new",
    );
  } finally {
    await close();
  }
});
