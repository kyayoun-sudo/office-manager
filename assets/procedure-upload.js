(function (root) {
  'use strict';
  var MAX = 100 * 1024 * 1024, SMALL = 3 * 1024 * 1024, CHUNK = 8 * 1024 * 1024;
  async function upload(file, options) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('FILE_EMPTY');
    if (file.size > MAX) throw new Error('FILE_TOO_LARGE');
    if (file.size <= SMALL) return options.small(file);
    var session = await options.start({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });
    var url = new URL(session.upload_url);
    if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.pathname !== '/upload/drive/v3/files' || url.username || url.password) throw new Error('INVALID_UPLOAD_SESSION');
    var send = options.fetch || root.fetch.bind(root);
    for (var offset = 0; offset < file.size; offset += CHUNK) {
      var end = Math.min(offset + CHUNK, file.size);
      var response = await send(url.href, { method: 'PUT', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + file.size },
        body: file.slice(offset, end) });
      if (end < file.size) {
        if (response.status !== 308 || response.headers.get('Range') !== 'bytes=0-' + (end - 1)) throw new Error('UPLOAD_INCOMPLETE');
      } else {
        if (!response.ok) throw new Error('UPLOAD_REFUSED_' + response.status);
        var receipt = await response.json();
        if (!receipt.id) throw new Error('UPLOAD_INCOMPLETE');
        if (options.progress) options.progress(100);
        return { file_id: receipt.id, name: receipt.name || session.name || file.name };
      }
      if (options.progress) options.progress(Math.floor(end * 100 / file.size));
    }
    throw new Error('UPLOAD_INCOMPLETE');
  }
  root.ProcedureUpload = { upload: upload, maxBytes: MAX };
})(window);
