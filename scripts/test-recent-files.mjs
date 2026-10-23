import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdfking-recents-")),
  handlers = new Map();
const electron = {
  app: {
    getPath: () => directory,
    getAppPath: () => process.cwd(),
    whenReady: () => ({ then: () => {} }),
    on: () => {},
  },
  BrowserWindow: {},
  dialog: {},
  shell: {},
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
};
const source = await fs.readFile("electron/main.cjs", "utf8");
vm.runInNewContext(source, {
  require: (name) =>
    name === "electron"
      ? electron
      : name === "./atomicWrite.cjs"
        ? require("../electron/atomicWrite.cjs")
        : name === "./rendererOrigin.cjs"
          ? require("../electron/rendererOrigin.cjs")
        : name === "./fontCompression.cjs"
          ? require("../electron/fontCompression.cjs")
        : name === "electron-updater"
          ? { autoUpdater: {} }
        : require(name),
  __dirname: path.join(process.cwd(), "electron"),
  process,
  Buffer,
  URL,
  setTimeout,
  clearTimeout,
  console,
});
const event = { senderFrame: { url: "http://127.0.0.1:5174/", parent: null } },
  call = (name, ...args) => handlers.get("pdfking:" + name)(event, ...args);
try {
  await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      call("add-recent-file", {
        name: "same-name.pdf",
        sourcePath: path.join(directory, `source-${i}.pdf`),
        data: new Uint8Array([37, 80, 68, 70, i]),
        pages: i + 1,
      }),
    ),
  );
  const entries = JSON.parse(
    await fs.readFile(path.join(directory, "recent-files/index.json"), "utf8"),
  );
  assert.equal(entries.length, 24);
  assert.equal(new Set(entries.map((e) => e.id)).size, 24);
  await call("add-recent-file", {
    name: "renamed.pdf",
    sourcePath: path.join(directory, "source-1.pdf"),
    data: new Uint8Array([37, 80, 68, 70, 99]),
    pages: 3,
  });
  const updated = await call("get-recent-files");
  assert.equal(updated.length, 24);
  assert.equal(updated[0].name, "renamed.pdf");
  assert.equal(updated[0].missing, true);
  await call("remove-recent-file", updated[0].id);
  assert.equal((await call("get-recent-files")).length, 23);
  assert.throws(
    () =>
      handlers.get("pdfking:get-recent-files")({
        senderFrame: { url: "https://untrusted.example/", parent: null },
      }),
    /untrusted/,
  );
  console.log(
    "Recent-file IPC checks passed: concurrent updates, atomic index, stable path identity, missing files, removal and renderer trust.",
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
