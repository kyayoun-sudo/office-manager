export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const path = url.pathname.toLowerCase()

  const blockedPaths = [
    '/wp-admin', '/wp-login', '/wp-content', '/wp-includes', '/wordpress',
    '/xmlrpc.php', '/wp-json',
    '/.env', '/.git', '/.svn', '/.htaccess', '/.htpasswd',
    '/phpmyadmin', '/pma', '/adminer', '/mysql',
    '/admin.php', '/administrator',
    '/cgi-bin', '/cgi',
    '/config.php', '/config.json', '/config.yml', '/config.yaml',
    '/debug', '/trace', '/actuator', '/metrics', '/healthz',
    '/vendor', '/node_modules',
    '/backup', '/dump', '/sql', '/database',
    '/shell', '/cmd', '/exec', '/eval',
    '/test', '/phpinfo',
    '/.aws', '/.docker', '/.kube',
  ]

  const blockedExtensions = [
    '.php', '.asp', '.aspx', '.jsp', '.cgi',
    '.sql', '.bak', '.old', '.orig', '.swp',
    '.log', '.ini', '.conf', '.cfg',
  ]

  if (blockedPaths.some((blocked) => path.startsWith(blocked))) {
    setResponseStatus(event, 404)
    return ''
  }

  if (blockedExtensions.some((ext) => path.endsWith(ext))) {
    setResponseStatus(event, 404)
    return ''
  }
})
