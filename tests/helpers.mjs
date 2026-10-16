import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import * as core from "../dist/core.mjs";
const html = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
const app = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");
export const settle = () => new Promise((resolve) => setImmediate(resolve));
export function createLocks() {
  const queues = new Map();
  return {
    request(name, options, callback) {
      const operation = (queues.get(name) || Promise.resolve())
        .catch(() => {})
        .then(callback);
      queues.set(
        name,
        operation.catch(() => {}),
      );
      return operation;
    },
  };
}
export function boot(seed, { storage, locks = createLocks() } = {}) {
  const window = new Window({
    url: "http://localhost:4173",
    settings: {
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(html);
  window.structuredClone = structuredClone;
  window.confirm = () => true;
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: locks,
  });
  if (storage)
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  else if (seed !== undefined)
    window.localStorage.setItem(
      core.STORAGE_KEY,
      typeof seed === "string" ? seed : JSON.stringify(seed),
    );
  window.__core = core;
  window.eval(
    app.replace(
      /^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/core\.mjs['"];?/,
      (_, names) => `const {${names}}=__core;`,
    ),
  );
  return { window, doc: window.document, close: () => window.happyDOM.abort() };
}
export async function submit(window, selector) {
  window.document
    .querySelector(selector)
    .dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  await settle();
}
export function stored(window) {
  return JSON.parse(window.localStorage.getItem(core.STORAGE_KEY));
}
export async function create(
  window,
  {
    name = "새 기간 작업",
    project = "Luum",
    start = "2026-10-13",
    end = "2026-10-19",
    owner = "임다혜",
  } = {},
) {
  const d = window.document;
  d.querySelector("[data-action=create]").click();
  d.querySelector("#newName").value = name;
  d.querySelector(`[data-new-project="${project}"]`).click();
  if (owner) d.querySelector(`#newOwners [data-owner="${owner}"]`).click();
  d.querySelector("#newStart").value = start;
  d.querySelector("#newEnd").value = end;
  await submit(window, "#createForm");
  return stored(window)?.tasks.find((t) => t.name === name);
}
export function sharedStorage(seed) {
  const data = new Map([[core.STORAGE_KEY, JSON.stringify(seed)]]);
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}
export function notify(env) {
  env.window.dispatchEvent(
    new env.window.StorageEvent("storage", {
      key: core.STORAGE_KEY,
      newValue: env.window.localStorage.getItem(core.STORAGE_KEY),
    }),
  );
}
