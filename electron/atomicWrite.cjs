const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
async function atomicWrite(destination, bytes) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`,
  );
  let handle;
  try {
    let mode = 0o600;
    try {
      mode = (await fs.stat(destination)).mode & 0o777;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    handle = await fs.open(temporary, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
module.exports = { atomicWrite };
