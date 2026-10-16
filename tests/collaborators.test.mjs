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
      name: "공동 디자인",
      project: "Luum",
      status: "진행 중",
      owner: "이유진",
      assignees: {
        이유진: "진행 중",
        임다혜: "진행 중",
        강주원: "진행 중",
        윤서영: "진행 중",
      },
      start: "2026-10-16",
      end: "2026-10-21",
      description: "",
    },
  ],
  links: [],
};
function setStatus(env, name, status, context = "detail") {
  const select = env.doc.querySelector(
    `#${context}AssigneeStatuses [data-assignee-status="${name}"]`,
  );
  select.value = status;
  select.dispatchEvent(new env.window.Event("change", { bubbles: true }));
}
function open(env) {
  env.doc.querySelector('[data-open="joint"]').click();
}

test("create one task with all four collaborators and independent statuses; reload preserves them", async () => {
  let env = boot({ tasks: [], links: [] }),
    raw,
    id;
  try {
    env.doc.querySelector(".add-row").click();
    env.doc.querySelector("#newName").value = "네 명이 함께";
    env.doc.querySelector("#expandCreate").click();
    for (const member of core.MEMBERS)
      env.doc.querySelector(`#newOwners [data-owner="${member.name}"]`).click();
    assert.equal(
      env.doc.querySelectorAll('#newOwners [aria-pressed="true"]').length,
      4,
    );
    setStatus(env, "이유진", "완료", "new");
    setStatus(env, "임다혜", "확인 필요", "new");
    env.doc.querySelector("#newStart").value = "2026-10-16";
    env.doc.querySelector("#newEnd").value = "2026-10-21";
    await submit(env.window, "#createForm");
    const task = stored(env.window).tasks[0];
    id = task.id;
    assert.equal(Object.keys(task.assignees).length, 4);
    assert.equal(task.assignees["이유진"], "완료");
    assert.equal(task.assignees["임다혜"], "확인 필요");
    assert.equal(task.status, "진행 중");
    assert.match(env.doc.querySelector("#taskRows").textContent, /1\/4 완료/);
    assert.ok(env.doc.querySelector(`.event[data-open="${id}"] .avatar-stack`));
    raw = env.window.localStorage.getItem(core.STORAGE_KEY);
  } finally {
    await env.close();
  }
  env = boot(raw);
  try {
    env.doc.querySelector(`[data-open="${id}"]`).click();
    assert.equal(
      env.doc.querySelector(
        '#detailAssigneeStatuses [data-assignee-status="이유진"]',
      ).value,
      "완료",
    );
    assert.equal(
      env.doc.querySelectorAll("#detailAssigneeStatuses select").length,
      4,
    );
  } finally {
    await env.close();
  }
});
test("assignee filters include every collaborator, not only the legacy primary owner", async () => {
  const env = boot(seed);
  try {
    for (const member of core.MEMBERS) {
      env.doc.querySelector("#ownerFilter").value = member.name;
      env.doc
        .querySelector("#ownerFilter")
        .dispatchEvent(new env.window.Event("change", { bubbles: true }));
      assert.ok(env.doc.querySelector('[data-row="joint"]'));
    }
    env.doc.querySelector("#ownerFilter").value = "__none";
    env.doc
      .querySelector("#ownerFilter")
      .dispatchEvent(new env.window.Event("change", { bubbles: true }));
    assert.equal(env.doc.querySelector('[data-row="joint"]'), null);
  } finally {
    await env.close();
  }
});
test("removing one collaborator preserves all remaining members and their statuses", async () => {
  const input = structuredClone(seed);
  input.tasks[0].assignees["임다혜"] = "확인 필요";
  const env = boot(input);
  try {
    open(env);
    env.doc.querySelector('#detailOwners [data-owner="이유진"]').click();
    await submit(env.window, "#detailForm");
    const task = stored(env.window).tasks[0];
    assert.equal(Object.hasOwn(task.assignees, "이유진"), false);
    assert.equal(task.assignees["임다혜"], "확인 필요");
    assert.equal(Object.keys(task.assignees).length, 3);
    assert.equal(task.owner, "임다혜");
  } finally {
    await env.close();
  }
});
test("unassigned is an explicit empty map and does not revive the old owner on reload", async () => {
  let env = boot(seed),
    raw;
  try {
    open(env);
    env.doc.querySelector('#detailOwners [data-owner=""]').click();
    await submit(env.window, "#detailForm");
    const task = stored(env.window).tasks[0];
    assert.deepEqual(task.assignees, {});
    assert.equal(task.owner, "");
    raw = env.window.localStorage.getItem(core.STORAGE_KEY);
  } finally {
    await env.close();
  }
  env = boot(raw);
  try {
    assert.match(env.doc.querySelector("#taskRows").textContent, /미정/);
  } finally {
    await env.close();
  }
});
test("four independent editors save their own statuses concurrently without overwriting teammates", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    editors = core.MEMBERS.map(() => boot(undefined, { storage, locks }));
  try {
    editors.forEach(open);
    for (let i = 0; i < 4; i++)
      setStatus(
        editors[i],
        core.MEMBERS[i].name,
        i === 1 ? "확인 필요" : "완료",
      );
    await Promise.all(editors.map((env) => submit(env.window, "#detailForm")));
    const task = JSON.parse(storage.getItem(core.STORAGE_KEY)).tasks[0];
    assert.equal(task.assignees["이유진"], "완료");
    assert.equal(task.assignees["임다혜"], "확인 필요");
    assert.equal(task.assignees["강주원"], "완료");
    assert.equal(task.assignees["윤서영"], "완료");
    assert.equal(task.status, "진행 중");
    for (const env of editors) {
      notify(env);
      assert.match(env.doc.querySelector("#taskRows").textContent, /3\/4 완료/);
      assert.equal(env.doc.querySelector("#detailDialog").open, false);
    }
  } finally {
    await Promise.all(editors.map((env) => env.close()));
  }
});
test("two conflicting edits to the same collaborator are rejected with input preserved", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    a = boot(undefined, { storage, locks }),
    b = boot(undefined, { storage, locks });
  try {
    open(a);
    open(b);
    setStatus(a, "이유진", "완료");
    setStatus(b, "이유진", "확인 필요");
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#detailForm"),
    ]);
    assert.equal(
      JSON.parse(storage.getItem(core.STORAGE_KEY)).tasks[0].assignees[
        "이유진"
      ],
      "완료",
    );
    assert.equal(b.doc.querySelector("#detailDialog").open, true);
    assert.equal(
      b.doc.querySelector(
        '#detailAssigneeStatuses [data-assignee-status="이유진"]',
      ).value,
      "확인 필요",
    );
    assert.match(b.doc.querySelector("#detailError").textContent, /다른 탭/);
  } finally {
    await a.close();
    await b.close();
  }
});
test("concurrent addition of different collaborators to an unassigned task keeps both", async () => {
  const blank = structuredClone(seed);
  blank.tasks[0].owner = "";
  blank.tasks[0].assignees = {};
  const storage = sharedStorage(blank),
    locks = createLocks(),
    a = boot(undefined, { storage, locks }),
    b = boot(undefined, { storage, locks });
  try {
    open(a);
    open(b);
    a.doc.querySelector('#detailOwners [data-owner="이유진"]').click();
    b.doc.querySelector('#detailOwners [data-owner="윤서영"]').click();
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#detailForm"),
    ]);
    assert.deepEqual(
      Object.keys(
        JSON.parse(storage.getItem(core.STORAGE_KEY)).tasks[0].assignees,
      ).sort(),
      ["이유진", "윤서영"].sort(),
    );
  } finally {
    await a.close();
    await b.close();
  }
});
test("undo only reverses my member status and retains another collaborator’s newer status", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    a = boot(undefined, { storage, locks }),
    b = boot(undefined, { storage, locks });
  try {
    open(a);
    open(b);
    setStatus(a, "이유진", "완료");
    await submit(a.window, "#detailForm");
    setStatus(b, "윤서영", "완료");
    await submit(b.window, "#detailForm");
    a.doc.querySelector("#undoButton").click();
    await settle();
    const task = JSON.parse(storage.getItem(core.STORAGE_KEY)).tasks[0];
    assert.equal(task.assignees["이유진"], "진행 중");
    assert.equal(task.assignees["윤서영"], "완료");
  } finally {
    await a.close();
    await b.close();
  }
});
test("a legacy single owner and completed task migrate without losing ownership or status", () => {
  const task = core.migrateState({
    tasks: [
      {
        id: "old",
        name: "기존작업",
        project: "Luum",
        status: "완료",
        owner: "윤서영",
      },
    ],
    links: [],
  }).tasks[0];
  assert.deepEqual(task.assignees, { 윤서영: "완료" });
  assert.equal(task.owner, "윤서영");
  assert.equal(task.status, "완료");
});
