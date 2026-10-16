import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../dist/core.mjs";
import {
  boot,
  submit,
  stored,
  settle,
  sharedStorage,
  createLocks,
  notify,
} from "./helpers.mjs";
const seed = {
  tasks: [
    {
      id: "joint",
      name: "공동 작업 기록 검증",
      project: "Luum",
      status: "진행 중",
      owner: "이유진",
      assignees: { 이유진: "진행 중", 윤서영: "진행 중" },
      start: "2026-10-16",
      end: "2026-10-22",
      description: "",
    },
  ],
  links: [],
};
function changePerson(env, name, status) {
  const select = env.doc.querySelector(`[data-assignee-status="${name}"]`);
  select.value = status;
  select.dispatchEvent(new env.window.Event("change", { bubbles: true }));
}
function open(env) {
  env.doc.querySelector('[data-open="joint"]').click();
}
function card(env, status, person = "") {
  const list = [
    ...env.doc.querySelectorAll(
      `.board-column[data-drop-status="${status}"] .board-card`,
    ),
  ];
  return list.find(
    (item) =>
      item.dataset.dragTask === "joint" &&
      (!person || item.dataset.dragPerson === person),
  );
}

test("regression: changing personal status makes it appear in the matching personal board column", async () => {
  const env = boot(seed);
  try {
    open(env);
    changePerson(env, "이유진", "확인 필요");
    await submit(env.window, "#detailForm");
    env.doc.querySelector('[data-view="board"]').click();
    assert.equal(
      env.doc
        .querySelector('[data-board-mode="member"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(card(env, "확인 필요", "이유진"));
    assert.ok(card(env, "진행 중", "윤서영"));
    assert.equal(stored(env.window).tasks[0].status, "진행 중");
    assert.equal(
      stored(env.window).activity.filter(
        (item) => item.kind === "member_status",
      ).length,
      1,
    );
    env.doc.querySelector('[data-board-mode="task"]').click();
    assert.ok(card(env, "진행 중"));
    assert.equal(
      env.doc.querySelector('.event [aria-label="이유진 · 확인 필요"]') !==
        null,
      true,
    );
  } finally {
    await env.close();
  }
});
test("regression: completing the overall task reveals it immediately instead of making it disappear", async () => {
  const env = boot(seed);
  try {
    env.doc.querySelector('[data-view="board"]').click();
    const select = env.doc.querySelector('[data-task-status="joint"]');
    select.value = "완료";
    select.dispatchEvent(new env.window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(env.doc.querySelector("#showDone").checked, true);
    assert.ok(card(env, "완료"));
    assert.equal(env.doc.querySelector(".event.completed") !== null, true);
    assert.equal(
      stored(env.window).activity.filter(
        (item) => item.kind === "task_status" && item.to === "완료",
      ).length,
      1,
    );
  } finally {
    await env.close();
  }
});
test("inline personal board status edits affect only that person, and keep the card visible on completion", async () => {
  const env = boot(seed);
  try {
    env.doc.querySelector('[data-view="board"]').click();
    env.doc.querySelector('[data-board-mode="member"]').click();
    const select = env.doc.querySelector(
      '[data-board-member-task="joint"][data-board-member="이유진"]',
    );
    select.value = "완료";
    select.dispatchEvent(new env.window.Event("change", { bubbles: true }));
    await settle();
    assert.ok(card(env, "완료", "이유진"));
    assert.ok(card(env, "진행 중", "윤서영"));
    assert.equal(stored(env.window).tasks[0].assignees["윤서영"], "진행 중");
    assert.equal(stored(env.window).tasks[0].status, "진행 중");
  } finally {
    await env.close();
  }
});
test("personal board drag changes the dragged person only", async () => {
  const env = boot(seed);
  try {
    env.doc.querySelector('[data-view="board"]').click();
    env.doc.querySelector('[data-board-mode="member"]').click();
    const target = card(env, "진행 중", "윤서영"),
      event = new env.window.Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: { setData() {} } });
    target.dispatchEvent(event);
    env.doc
      .querySelector('[data-drop-status="확인 필요"]')
      .dispatchEvent(
        new env.window.Event("drop", { bubbles: true, cancelable: true }),
      );
    await settle();
    assert.equal(stored(env.window).tasks[0].assignees["윤서영"], "확인 필요");
    assert.equal(stored(env.window).tasks[0].assignees["이유진"], "진행 중");
    assert.equal(stored(env.window).tasks[0].status, "진행 중");
  } finally {
    await env.close();
  }
});
test("existing tasks get no invented historical events; manual work notes persist and filter by member", async () => {
  let env = boot(seed),
    raw;
  try {
    env.doc.querySelector('[data-view="activity"]').click();
    assert.equal(env.doc.querySelectorAll(".activity-entry").length, 0);
    env.doc.querySelector('[data-activity-member="이유진"]').click();
    env.doc.querySelector("#noteTask").value = "joint";
    env.doc.querySelector("#noteText").value = "패키지 시안 2개 제작";
    await submit(env.window, "#worklogForm");
    assert.equal(stored(env.window).activity.length, 1);
    assert.equal(stored(env.window).activity[0].kind, "note");
    assert.equal(stored(env.window).activity[0].member, "이유진");
    assert.match(
      env.doc.querySelector("#activityList").textContent,
      /패키지 시안 2개 제작/,
    );
    env.doc.querySelector('[data-activity-member="윤서영"]').click();
    assert.equal(env.doc.querySelectorAll(".activity-entry").length, 0);
    raw = env.window.localStorage.getItem(core.STORAGE_KEY);
  } finally {
    await env.close();
  }
  env = boot(raw);
  try {
    env.doc.querySelector('[data-view="activity"]').click();
    assert.match(
      env.doc.querySelector("#activityList").textContent,
      /패키지 시안 2개 제작/,
    );
    assert.equal(stored(env.window).activity.length, 1);
  } finally {
    await env.close();
  }
});
test("completion filters do not hide history, and deleted tasks keep their named historical records", async () => {
  const env = boot(seed);
  try {
    open(env);
    env.doc.querySelector("#detailStatus").value = "완료";
    await submit(env.window, "#detailForm");
    env.doc.querySelector("#showDone").checked = false;
    env.doc
      .querySelector("#showDone")
      .dispatchEvent(new env.window.Event("change", { bubbles: true }));
    env.doc.querySelector('[data-view="activity"]').click();
    assert.match(
      env.doc.querySelector("#activityList").textContent,
      /전체 상태 · 진행 중 → 완료/,
    );
    env.doc.querySelector(".activity-task").click();
    env.doc.querySelector("#deleteTask").click();
    await settle();
    assert.equal(stored(env.window).tasks.length, 0);
    assert.equal(stored(env.window).activity.length, 2);
    assert.match(
      env.doc.querySelector("#activityList").textContent,
      /공동 작업 기록 검증 · 삭제된 작업/,
    );
  } finally {
    await env.close();
  }
});
test("undo adds a reversal record and never removes the original history", async () => {
  const env = boot(seed);
  try {
    open(env);
    changePerson(env, "이유진", "완료");
    await submit(env.window, "#detailForm");
    env.doc.querySelector("#undoButton").click();
    await settle();
    const logs = stored(env.window).activity;
    assert.equal(logs.length, 2);
    assert.equal(logs[0].to, "완료");
    assert.equal(logs[1].to, "진행 중");
    assert.equal(logs[1].source, "undo");
    assert.equal(logs[1].member, "이유진");
  } finally {
    await env.close();
  }
});
test("four independent editors produce four distinct member records without losing or duplicating events", async () => {
  const input = structuredClone(seed);
  input.tasks[0].assignees = Object.fromEntries(
    core.MEMBERS.map((member) => [member.name, "진행 중"]),
  );
  const storage = sharedStorage(input),
    locks = createLocks(),
    envs = core.MEMBERS.map(() => boot(undefined, { storage, locks }));
  try {
    envs.forEach(open);
    envs.forEach((env, i) => changePerson(env, core.MEMBERS[i].name, "완료"));
    await Promise.all(envs.map((env) => submit(env.window, "#detailForm")));
    const logs = JSON.parse(storage.getItem(core.STORAGE_KEY)).activity;
    assert.equal(logs.length, 4);
    assert.equal(new Set(logs.map((item) => item.id)).size, 4);
    assert.deepEqual(
      logs.map((item) => item.member).sort(),
      core.MEMBERS.map((member) => member.name).sort(),
    );
    envs.forEach((env) => notify(env));
    for (const env of envs) {
      env.doc.querySelector('[data-view="activity"]').click();
      assert.equal(env.doc.querySelectorAll(".activity-entry").length, 4);
    }
  } finally {
    await Promise.all(envs.map((env) => env.close()));
  }
});
test("rejected status conflict does not create a false success record", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    a = boot(undefined, { storage, locks }),
    b = boot(undefined, { storage, locks });
  try {
    open(a);
    open(b);
    changePerson(a, "이유진", "완료");
    changePerson(b, "이유진", "확인 필요");
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#detailForm"),
    ]);
    const logs = JSON.parse(storage.getItem(core.STORAGE_KEY)).activity;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].to, "완료");
    assert.equal(b.doc.querySelector("#detailDialog").open, true);
  } finally {
    await a.close();
    await b.close();
  }
});
test("manual note and a concurrent status change both survive in one shared activity stream", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    a = boot(undefined, { storage, locks }),
    b = boot(undefined, { storage, locks });
  try {
    open(a);
    changePerson(a, "윤서영", "확인 필요");
    b.doc.querySelector('[data-view="activity"]').click();
    b.doc.querySelector("#noteMember").value = "이유진";
    b.doc.querySelector("#noteTask").value = "joint";
    b.doc.querySelector("#noteText").value = "색상 정리";
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#worklogForm"),
    ]);
    const logs = JSON.parse(storage.getItem(core.STORAGE_KEY)).activity;
    assert.equal(logs.length, 2);
    assert.equal(logs.filter((item) => item.kind === "note").length, 1);
    assert.equal(
      logs.filter((item) => item.kind === "member_status").length,
      1,
    );
  } finally {
    await a.close();
    await b.close();
  }
});
test("failed save keeps the work note input and creates no persisted record", async () => {
  const env = boot(seed);
  try {
    env.doc.querySelector('[data-view="activity"]').click();
    env.doc.querySelector("#noteMember").value = "윤서영";
    env.doc.querySelector("#noteTask").value = "joint";
    env.doc.querySelector("#noteText").value = "실패 시 유지할 기록";
    const storage = env.window.localStorage;
    Object.defineProperty(env.window, "localStorage", {
      value: {
        getItem: storage.getItem.bind(storage),
        setItem() {
          throw new Error("quota");
        },
      },
      configurable: true,
    });
    await submit(env.window, "#worklogForm");
    assert.equal(
      env.doc.querySelector("#noteText").value,
      "실패 시 유지할 기록",
    );
    assert.equal(
      (JSON.parse(storage.getItem(core.STORAGE_KEY)).activity || []).length,
      0,
    );
    assert.match(
      env.doc.querySelector("#worklogError").textContent,
      /저장하지 못/,
    );
  } finally {
    await env.close();
  }
});
test("third tab supports arrow keys and manual note text is escaped", async () => {
  const env = boot(seed);
  try {
    env.doc.querySelector('[data-view="board"]').click();
    env.doc
      .querySelector(".view-tabs")
      .dispatchEvent(
        new env.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    assert.equal(env.doc.querySelector("#activityView").hidden, false);
    env.doc.querySelector("#noteMember").value = "강주원";
    env.doc.querySelector("#noteTask").value = "joint";
    env.doc.querySelector("#noteText").value = "<img src=x onerror=alert(1)>";
    await submit(env.window, "#worklogForm");
    assert.equal(env.doc.querySelectorAll("#activityList img").length, 0);
    assert.match(env.doc.querySelector("#activityList").textContent, /<img/);
  } finally {
    await env.close();
  }
});
