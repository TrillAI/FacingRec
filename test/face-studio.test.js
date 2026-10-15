import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaceStudioView } from '../src/trill/FaceStudio.tsx';

const renderStudio = () => renderToStaticMarkup(React.createElement(FaceStudioView));

test('Face Studio renders its avatar library, emotions, and animation choices', () => {
  const html = renderStudio();

  for (const name of ['Nova', 'Milo', 'Zuri', 'Arlo', 'Sage', 'Koa', 'Mira', 'Theo']) {
    assert.match(html, new RegExp(`>${name}<`), `missing avatar preset: ${name}`);
  }
  for (const name of ['Calm', 'Joy', 'Laugh', 'Surprise', 'Curious', 'Focus', 'Sad', 'Sleepy', 'Confident', 'Frustrated']) {
    assert.match(html, new RegExp(`>${name}<`), `missing emotion choice: ${name}`);
  }
  for (const name of ['Still pose', 'Breathing', 'Chewing gum', 'Blink loop', 'Talking', 'Nodding', 'Soft float']) {
    assert.ok(html.includes(name), `missing animation choice: ${name}`);
  }

  assert.equal((html.match(/studio-avatar-card/g) || []).length, 8);
  assert.equal((html.match(/studio-emotion-card/g) || []).length, 10);
  assert.equal((html.match(/studio-motion-card/g) || []).length, 7);
  assert.match(html, /studio-motion-breathing/);
  assert.match(html, /aria-pressed="true"/);
});

test('Face Studio exposes labeled controls and keeps the preview illustrative', () => {
  const html = renderStudio();

  assert.match(html, /id="studio-intensity"/);
  assert.match(html, /for="studio-intensity"/);
  assert.match(html, /id="studio-speed"/);
  assert.match(html, /for="studio-speed"/);
  assert.match(html, /aria-label="Pause animation"/);
  assert.match(html, /Export preset/);
  assert.match(html, /no camera feed/i);
  assert.match(html, /not enrolled people or camera footage/i);
});
