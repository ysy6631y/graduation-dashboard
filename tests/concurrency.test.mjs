import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import * as core from "../dist/core.mjs";
import {
  boot,
  submit,
  stored,
  create,
  settle,
  sharedStorage,
  createLocks,
  notify,
} from "./helpers.mjs";

const seed = {
  tasks: [
    {
      id: "original",
      name: "공동 작업",
      project: "Luum",
      status: "진행 중",
      owner: "이유진",
      start: "2026-10-16",
      end: "2026-10-20",
      description: "원래 메모",
      custom: "보존",
    },
  ],
  links: [
    {
      id: "drive",
      label: "공통",
      title: "자료",
      url: "https://example.com/old",
    },
  ],
};
const read = (storage) => JSON.parse(storage.getItem(core.STORAGE_KEY));
function team(count = 4) {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    members = Array.from({ length: count }, () =>
      boot(undefined, { storage, locks }),
    );
  return {
    storage,
    locks,
    members,
    close: () => Promise.all(members.map((m) => m.close())),
  };
}
function edit(env, id = "original") {
  env.doc.querySelector(`[data-open="${id}"]`).click();
}
async function externalEdit(team, patch) {
  const before = core.migrateState(read(team.storage));
  const proposed = {
    ...before,
    tasks: before.tasks.map((t) =>
      t.id === "original" ? { ...t, ...patch } : t,
    ),
  };
  return core.persistConcurrent(team.storage, before, proposed, {
    locks: team.locks,
  });
}

test("regression: status undo refuses to overwrite a later status from another tab", async () => {
  const t = team(1),
    env = t.members[0];
  try {
    const select = env.doc.querySelector('[data-task-status="original"]');
    select.value = "완료";
    select.dispatchEvent(new env.window.Event("change", { bubbles: true }));
    await settle();
    await externalEdit(t, { status: "확인 필요" });
    notify(env);
    env.doc.querySelector("#undoButton").click();
    await settle();
    assert.equal(read(t.storage).tasks[0].status, "확인 필요");
    assert.match(env.doc.querySelector("#toastMessage").textContent, /다른 탭/);
  } finally {
    await t.close();
  }
});
test("regression: detail undo reverses only own title edit and keeps another tab’s newer memo", async () => {
  const t = team(1),
    env = t.members[0];
  try {
    edit(env);
    env.doc.querySelector("#detailName").value = "내 제목 변경";
    await submit(env.window, "#detailForm");
    await externalEdit(t, { description: "팀원의 새 메모" });
    notify(env);
    env.doc.querySelector("#undoButton").click();
    await settle();
    const result = read(t.storage).tasks[0];
    assert.equal(result.name, seed.tasks[0].name);
    assert.equal(result.description, "팀원의 새 메모");
    assert.equal(result.custom, "보존");
  } finally {
    await t.close();
  }
});
test("regression: a tab with no storage event preserves another tab’s new task", async () => {
  const t = team(2);
  try {
    await create(t.members[1].window, { name: "먼저 등록" });
    await create(t.members[0].window, { name: "늦게 등록" });
    assert.equal(read(t.storage).tasks.length, 3);
    assert.ok(read(t.storage).tasks.some((task) => task.name === "먼저 등록"));
  } finally {
    await t.close();
  }
});
test("four independent app windows: 80 concurrent registrations with delayed events lose no tasks", async () => {
  const t = team();
  try {
    for (let round = 0; round < 20; round++)
      await Promise.all(
        t.members.map((env, i) =>
          create(env.window, {
            name: `팀원${i + 1}-${round}`,
            project: i % 2 ? "LivyDuvy" : "Luum",
            owner: core.MEMBERS[i].name,
          }),
        ),
      );
    const result = read(t.storage);
    assert.equal(result.tasks.length, 81);
    assert.equal(new Set(result.tasks.map((task) => task.id)).size, 81);
    t.members.forEach((env) => notify(env));
    for (const env of t.members)
      assert.equal(env.doc.querySelectorAll("[data-row]").length, 81);
    assert.deepEqual(JSON.parse(t.storage.getItem(core.BACKUP_KEY)), seed);
  } finally {
    await t.close();
  }
});
test("same task, different fields: concurrent owner and memo edits both survive", async () => {
  const t = team(2),
    [a, b] = t.members;
  try {
    edit(a);
    edit(b);
    a.doc.querySelector('#detailOwners [data-owner="임다혜"]').click();
    b.doc.querySelector("#detailDescription").value = "다른 팀원의 메모";
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#detailForm"),
    ]);
    const result = read(t.storage).tasks[0];
    assert.equal(result.assignees["임다혜"], "진행 중");
    assert.equal(result.assignees["이유진"], "진행 중");
    assert.equal(result.description, "다른 팀원의 메모");
    assert.equal(a.doc.querySelector("#detailDialog").open, false);
    assert.equal(b.doc.querySelector("#detailDialog").open, false);
  } finally {
    await t.close();
  }
});
test("same task, same field: one commit wins, conflicting form keeps its unsaved text", async () => {
  const t = team(2),
    [a, b] = t.members;
  try {
    edit(a);
    edit(b);
    a.doc.querySelector("#detailName").value = "A 제목";
    b.doc.querySelector("#detailName").value = "B 제목";
    await Promise.all([
      submit(a.window, "#detailForm"),
      submit(b.window, "#detailForm"),
    ]);
    assert.equal(read(t.storage).tasks[0].name, "A 제목");
    assert.equal(b.doc.querySelector("#detailDialog").open, true);
    assert.equal(b.doc.querySelector("#detailName").value, "B 제목");
    assert.match(b.doc.querySelector("#detailError").textContent, /다른 탭/);
    assert.equal(
      b.doc.querySelector("#saveIndicator").textContent,
      "변경사항 충돌",
    );
  } finally {
    await t.close();
  }
});
test("a double submit while waiting for a save creates exactly one record", async () => {
  const t = team(1),
    env = t.members[0];
  try {
    env.doc.querySelector(".add-row").click();
    env.doc.querySelector("#newName").value = "중복 클릭";
    const first = submit(env.window, "#createForm"),
      second = submit(env.window, "#createForm");
    await Promise.all([first, second]);
    assert.equal(
      env.doc.querySelector("#saveIndicator").textContent,
      "이 브라우저에 저장됨",
    );
    assert.equal(
      read(t.storage).tasks.filter((task) => task.name === "중복 클릭").length,
      1,
    );
  } finally {
    await t.close();
  }
});
test("edit/delete conflict protects the newer edit instead of deleting it", async () => {
  const t = team(2),
    [a, b] = t.members;
  try {
    edit(a);
    edit(b);
    a.doc.querySelector("#detailDescription").value =
      "삭제하면 안 되는 새 메모";
    await submit(a.window, "#detailForm");
    b.doc.querySelector("#deleteTask").click();
    await settle();
    assert.equal(read(t.storage).tasks.length, 1);
    assert.equal(
      read(t.storage).tasks[0].description,
      "삭제하면 안 되는 새 메모",
    );
    assert.equal(b.doc.querySelector("#detailDialog").open, true);
  } finally {
    await t.close();
  }
});
test("an edit after another tab deletes the task never resurrects the deleted task", async () => {
  const t = team(2),
    [a, b] = t.members;
  try {
    edit(a);
    edit(b);
    a.doc.querySelector("#deleteTask").click();
    await settle();
    b.doc.querySelector("#detailName").value = "삭제된 작업 편집";
    await submit(b.window, "#detailForm");
    assert.equal(read(t.storage).tasks.length, 0);
    assert.equal(b.doc.querySelector("#detailDialog").open, true);
  } finally {
    await t.close();
  }
});
test("independent date edits that form an invalid combined interval are rejected atomically", async () => {
  const storage = sharedStorage(seed),
    locks = createLocks(),
    before = core.migrateState(seed);
  await core.persistConcurrent(
    storage,
    before,
    {
      ...before,
      tasks: before.tasks.map((t) => ({ ...t, start: "2026-10-19" })),
    },
    { locks },
  );
  await assert.rejects(
    core.persistConcurrent(
      storage,
      before,
      {
        ...before,
        tasks: before.tasks.map((t) => ({ ...t, end: "2026-10-17" })),
      },
      { locks },
    ),
    core.ConcurrentEditError,
  );
  assert.equal(read(storage).tasks[0].start, "2026-10-19");
  assert.equal(read(storage).tasks[0].end, "2026-10-20");
});
test("resource URL conflicts are detected and do not overwrite another tab’s URL", async () => {
  const t = team(2),
    [a, b] = t.members;
  try {
    a.doc.querySelector('[data-link="drive"]').click();
    b.doc.querySelector('[data-link="drive"]').click();
    a.doc.querySelector("#linkUrl").value = "https://example.com/a";
    b.doc.querySelector("#linkUrl").value = "https://example.com/b";
    await Promise.all([
      submit(a.window, "#linkForm"),
      submit(b.window, "#linkForm"),
    ]);
    assert.equal(read(t.storage).links[0].url, "https://example.com/a");
    assert.equal(b.doc.querySelector("#linkDialog").open, true);
    assert.match(b.doc.querySelector("#linkError").textContent, /다른 탭/);
  } finally {
    await t.close();
  }
});
test("late storage notifications read the current payload and never roll the screen back", async () => {
  const t = team(1),
    env = t.members[0];
  try {
    const oldRaw = t.storage.getItem(core.STORAGE_KEY);
    await externalEdit(t, { name: "최신 제목" });
    env.window.dispatchEvent(
      new env.window.StorageEvent("storage", {
        key: core.STORAGE_KEY,
        newValue: oldRaw,
      }),
    );
    assert.match(env.doc.querySelector("#taskRows").textContent, /최신 제목/);
  } finally {
    await t.close();
  }
});
test("deleted or corrupted storage is not silently overwritten during a queued write", async () => {
  for (const invalid of [null, "{invalid-json"]) {
    const storage = sharedStorage(seed),
      locks = createLocks(),
      before = core.migrateState(seed);
    if (invalid === null) storage.removeItem(core.STORAGE_KEY);
    else storage.setItem(core.STORAGE_KEY, invalid);
    await assert.rejects(
      core.persistConcurrent(
        storage,
        before,
        { ...before, tasks: [] },
        { locks, requireExisting: true },
      ),
    );
    assert.equal(storage.getItem(core.STORAGE_KEY), invalid);
  }
});
test("IndexedDB fallback serializes four writers and preserves all 160 registrations", async () => {
  const storage = sharedStorage(seed),
    indexedDB = new IDBFactory(),
    before = core.migrateState(seed);
  const connections = Array.from({ length: 4 }, () => ({
    open: indexedDB.open.bind(indexedDB),
  }));
  await Promise.all(
    Array.from({ length: 160 }, (_, i) =>
      core.persistConcurrent(
        storage,
        before,
        {
          ...before,
          tasks: [
            ...before.tasks,
            { ...before.tasks[0], id: `fallback-${i}`, name: `작업 ${i}` },
          ],
        },
        { indexedDB: connections[i % 4] },
      ),
    ),
  );
  assert.equal(read(storage).tasks.length, 161);
});
test("no lock capability: fail visibly rather than using an unsafe concurrent write", async () => {
  const storage = sharedStorage(seed),
    before = core.migrateState(seed);
  await assert.rejects(
    core.persistConcurrent(storage, before, { ...before, tasks: [] }),
    /안전하게 저장/,
  );
  assert.deepEqual(read(storage), seed);
});
