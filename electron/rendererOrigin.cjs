const path = require('node:path');
const { fileURLToPath } = require('node:url');

/** Compare decoded native paths, retaining the dist boundary and dev origin. */
function isAppRendererURL(value, appDirectory) {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      const root = path.resolve(appDirectory, 'dist');
      const relative = path.relative(root, fileURLToPath(url));
      return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5174';
  } catch { return false; }
}
module.exports = { isAppRendererURL };
