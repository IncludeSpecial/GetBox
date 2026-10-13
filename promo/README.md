# Промо-ролики GetBox

- `promo.html` — основной ролик: 40 с, 1920×1080, 30 fps.
- `promo13.html` — обычное промо 1.3: 53 с, тёмное, монтаж в долю под `music13.wav`. Окно приложения стоит на месте, заголовки — над ним.
- `director.js` — общая камера и подсветка для `promo13.html` и `corp13.html`. Зумы и выноски берутся только из `shots/13/marks.json`: `capture13.cjs` измеряет реальные элементы интерфейса на каждом скриншоте. Размер задаётся параметром `h` (240…1080), `debug=1` выводит номер сцены и таймкод.
- `edit13.html` — динамичный эдит 1.3: ~25 с, 130 BPM, склейка на каждую долю (во втором дропе — на полдоли), удары зумом, вспышки, слова-титры. Музыка — `music-edit13.py` (фонк-набросок: ковбелл, 808 с глайдом).
- `corp13.html` — корпоративное промо 1.3: 50 с, светлый стиль. Проблема → решение → 4 блока (каталог, установка, обновления, интерфейс) с выносками на интерфейсе → сводка → призыв. Музыка — `music-corp13.py` (фортепиано и пэд, 100 BPM).
- `shorts.html` — вертикальная версия для Shorts / Reels: 30 с, 1080×1920, 60 fps, монтаж по долям 128 BPM.

Кадры интерфейса — настоящий renderer GetBox на тестовых данных из `data/`.

```bash
npm run build                          # собрать dist/ (renderer)
node promo/capture.cjs                 # скриншоты интерфейса → promo/shots/
node promo/render.cjs stills promo.html 12 23.5   # (по желанию) отдельные кадры для проверки
node promo/render.cjs video promo.html            # покадровый рендер → promo/promo.mp4
python3 promo/music.py                 # фоновая музыка → promo/music.wav (нужен numpy)
ffmpeg -i promo/promo.mp4 -i promo/music.wav -c:v copy -c:a aac -b:a 192k -shortest promo/GetBox-promo.mp4

# 1.3 — скриншоты всех тем и видов → promo/shots/13/, затем черновик 240p
node promo/capture13.cjs
QUERY="h=240&debug=1" OUT_SUFFIX=-240p CRF=28 node promo/render.cjs video promo13.html
python3 promo/music13.py
ffmpeg -i promo/promo13-240p.mp4 -i promo/music13.wav -c:v copy -c:a aac -b:a 96k -shortest promo/GetBox-1.3-preview-240p.mp4
# 1.3 — финал: QUERY="h=1080" node promo/render.cjs video promo13.html

# 1.3 — эдит 360p
QUERY="h=360" OUT_SUFFIX=-360p CRF=24 node promo/render.cjs video edit13.html
python3 promo/music-edit13.py
ffmpeg -i promo/edit13-360p.mp4 -i promo/music-edit13.wav -c:v copy -af loudnorm=I=-12:TP=-1 -c:a aac -b:a 128k -shortest promo/GetBox-1.3-edit-360p.mp4

# 1.3 — корпоративное промо 360p
QUERY="h=360" OUT_SUFFIX=-360p CRF=24 node promo/render.cjs video corp13.html
python3 promo/music-corp13.py
ffmpeg -i promo/corp13-360p.mp4 -i promo/music-corp13.wav -c:v copy -af loudnorm=I=-16:TP=-1.5 -c:a aac -b:a 128k -shortest promo/GetBox-1.3-corporate-360p.mp4

# Shorts
node promo/render.cjs video shorts.html
python3 promo/music-shorts.py
ffmpeg -i promo/shorts.mp4 -i promo/music-shorts.wav -c:v copy -af loudnorm=I=-13:TP=-1 -c:a aac -b:a 192k -shortest promo/GetBox-shorts.mp4
```

Нужны Playwright с Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` — если стоят не в стандартном месте) и ffmpeg с libx264.

- `promo.html` — сцены; `render(t)` задаёт состояние кадра по времени, поэтому рендер детерминированный. Тексты и тайминги — там же.
- `music.py`, `music-shorts.py`, `music13.py` — синтезированная музыка (96, 128 и 120 BPM, Am–F–C–G), без сторонних сэмплов.
