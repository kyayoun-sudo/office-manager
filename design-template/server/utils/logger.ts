function log(level: string, args: any[]) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  const timestamp = new Date().toLocaleTimeString('fr-FR')
  if (args.length === 2 && typeof args[0] === 'object' && typeof args[1] === 'string') {
    fn(`[${timestamp}] [proxy] ${args[1]}`, JSON.stringify(args[0], null, 2))
  } else {
    fn(`[${timestamp}] [proxy]`, ...args)
  }
}

export const logger = {
  info: (...args: any[]) => log('info', args),
  debug: (...args: any[]) => log('debug', args),
  error: (...args: any[]) => log('error', args),
  warn: (...args: any[]) => log('warn', args),
}
