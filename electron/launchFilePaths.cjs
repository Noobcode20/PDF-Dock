const path = require('node:path')

function isPdfLaunchPath(value, pathApi = path) {
  return typeof value === 'string' && pathApi.isAbsolute(value) && /\.pdf$/i.test(value)
}

module.exports = { isPdfLaunchPath }
