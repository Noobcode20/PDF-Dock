import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url),
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdfking-recents-")),
  handlers = new Map();
const electron = {
  app: {
    getPath: () => directory,
    getVersion: () => "0.1.0-beta.2",
    isPackaged: false,
    getAppPath: () => process.cwd(),
    whenReady: () => ({ then: () => {} }),
    requestSingleInstanceLock: () => true,
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
        : name === "./updateController.cjs"
          ? require("../electron/updateController.cjs")
        : name === "electron-updater"
          ? { autoUpdater: new EventEmitter() }
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
  const libraryId = updated[0].id;
  // Equal-size edits must replace cached bytes, not silently reuse the old PDF.
  await call("add-recent-file", { name: "renamed.pdf", data: new Uint8Array([37, 80, 68, 70, 77]), libraryId });
  assert.deepEqual([...await call("read-recent-file", libraryId)], [37, 80, 68, 70, 77]);
  await call("add-recent-file", { name: "renamed.pdf", data: new Uint8Array([37, 80, 68, 70, 88]), libraryId });
  assert.equal((await call("get-recent-files")).length, 24);
  assert.deepEqual([...await call("read-recent-file", libraryId)], [37, 80, 68, 70, 88]);
  assert.equal((await call("get-recent-files"))[0].sourcePath, null);
  assert.equal((await call("get-recent-files"))[0].pages, 3, "Library saves preserve known page count");
  await assert.rejects(call("add-recent-file", { name: "bad.pdf", data: new Uint8Array([1]), libraryId: "../escape" }), /Invalid library/);
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
