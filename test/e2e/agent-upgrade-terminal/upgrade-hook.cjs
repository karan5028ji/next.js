const childProcess = require('node:child_process')
const spawn = childProcess.spawn

// Route only this fixture's standalone upgrade bootstrap to its packed candidate.
childProcess.spawn = function (command, args, options) {
  const packageIndex = args?.indexOf('@next/upgrade@canary') ?? -1
  if (packageIndex !== -1) {
    return spawn(
      process.execPath,
      [
        require
          .resolve('@next/upgrade/package.json')
          .replace(/package\.json$/, 'dist/bin/next-upgrade.js'),
        ...args.slice(packageIndex + 1),
      ],
      options
    )
  }
  return spawn(command, args, options)
}
