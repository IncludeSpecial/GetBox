/* global window, XMLHttpRequest */
// Shared camera and highlight logic for promo13.html and corp13.html.
//
// Every zoom targets a real element: capture13.cjs measures element rects on
// each screenshot (shots/13/marks.json, CSS px of the 1440×900 frame). A camera
// is a list of stops; between stops it eases, at a stop it holds still. A
// highlight dims the rest of the window and labels the element, and only
// appears once the camera has arrived.
(function () {
  const SHOT_W = 1440, SHOT_H = 900;
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'shots/13/marks.json', false);
  xhr.send();
  const MARKS = JSON.parse(xhr.responseText);

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const inOut = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const FULL = { x: 0, y: 0, w: SHOT_W, h: SHOT_H };

  function mark(shot, key) {
    const m = MARKS[shot] && MARKS[shot][key];
    if (!m) throw new Error(`no mark ${shot}.${key} — re-run capture13.cjs`);
    return m;
  }

  /**
   * The view rect that frames an element: padded, grown to the viewer's aspect,
   * never closer than maxZoom and never past the screenshot's edges.
   */
  function fit(shot, key, { pad = 48, maxZoom = 2, aspect = SHOT_W / SHOT_H } = {}) {
    const m = mark(shot, key);
    let w = Math.max(m.w + pad * 2, (m.h + pad * 2) * aspect, SHOT_W / maxZoom);
    w = Math.min(w, SHOT_W);
    const h = w / aspect;
    const x = clamp(m.x + m.w / 2 - w / 2, 0, SHOT_W - w);
    const y = clamp(m.y + m.h / 2 - h / 2, 0, SHOT_H - h);
    return { x, y, w, h };
  }

  /** Camera rect at local time lt. stops: [{ at, rect }]; the move into each stop lasts `move` seconds. */
  function camera(stops, lt, move = 0.8) {
    let rect = stops[0].rect;
    for (let i = 1; i < stops.length; i++) {
      const s = stops[i];
      const k = inOut(seg(lt, s.at - move, s.at));
      if (k <= 0) break;
      rect = mixRect(rect, s.rect, k);
    }
    return rect;
  }
  const mixRect = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

  /** Point the cam element (a 1440×900 layer) at a view rect inside a vw×vh viewer. */
  function apply(cam, vw, vh, r) {
    const s = vw / r.w;
    const tx = -r.x * s, ty = -r.y * s;
    cam.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    return { s, tx, ty };
  }

  /**
   * Highlight: `box` dims everything around the element and outlines it; `tag` sits
   * just above the element (below it when there is no room), kept inside the viewer.
   */
  function highlight(box, tag, view, cam, m, k, vw, vh) {
    if (k <= 0) {
      box.style.opacity = 0; tag.style.opacity = 0;
      return;
    }
    const pad = 6;
    const x = m.x * cam.s + cam.tx - pad, y = m.y * cam.s + cam.ty - pad;
    const w = m.w * cam.s + pad * 2, h = m.h * cam.s + pad * 2;
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: k });
    tag.style.opacity = k;
    const tw = tag.offsetWidth, th = tag.offsetHeight;
    const above = y - th - 14 >= 10;
    const ty = above ? y - th - 14 : Math.min(vh - th - 10, y + h + 14);
    const tx = clamp(x, 10, vw - tw - 10);
    tag.style.left = tx + 'px';
    tag.style.top = ty + 'px';
    tag.style.transform = `translateY(${(1 - k) * (above ? 8 : -8)}px)`;
    void view;
  }

  window.Director = { MARKS, FULL, mark, fit, camera, apply, highlight, clamp, seg, lerp, inOut, outCubic };
})();
