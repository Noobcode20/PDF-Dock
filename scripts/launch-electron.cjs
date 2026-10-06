const { spawn } = require('node:child_process')
const electronPath = require('electron')

const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5174' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env })
child.on('error', (error) => {
  console.error(`Could not start Electron: ${error.message}`)
  process.exitCode = 1
})
child.on('close', (code, signal) => {
  if (signal) {
    console.error(`Electron closed from ${signal}`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}
