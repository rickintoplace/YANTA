export function youtubeVideoId(url) {
  const s = String(url || '').trim();

  try {
    const u = new URL(s, location.href);
    const host = u.hostname.replace(/^www\./, '');

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (u.pathname === '/watch') {
        return u.searchParams.get('v') || '';
      }

      const embed = /^\/embed\/([a-zA-Z0-9_-]{6,})/.exec(u.pathname);
      if (embed) return embed[1];

      const shorts = /^\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(u.pathname);
      if (shorts) return shorts[1];
    }

    if (host === 'youtu.be') {
      return u.pathname.replace(/^\//, '').split('/')[0] || '';
    }
  } catch {}

  let m;

  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  if ((m = /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  if ((m = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  return '';
}

export function videoEmbedUrl(url) {
  const s = String(url || '').trim();

  const yt = youtubeVideoId(s);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}`;

  let m;

  if ((m = /vimeo\.com\/(\d+)/.exec(s))) {
    return `https://player.vimeo.com/video/${m[1]}`;
  }

  return '';
}

export function videoThumbnailUrl(url) {
  const yt = youtubeVideoId(url);

  if (yt) {
    return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
  }

  return '';
}

export function audioEmbedUrl(url) {
  const s = String(url || '').trim();

  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav)(?:$|[?#])/i.test(s)) {
    return s;
  }

  return '';
}