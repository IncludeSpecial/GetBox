# Промо-ролики GetBox

- `promo.html` — основной ролик: 40 с, 1920×1080, 30 fps.
- `promo13.html` — обычное промо 1.3: 53 с, тёмное, монтаж в долю под `music13.wav`. Окно приложения стоит на месте, заголовки — над ним.
- `director.js` — общая камера и подсветка для `promo13.html` и `corp13.html`. Зумы и выноски берутся только из `shots/13/marks.json`: `capture13.cjs` измеряет реальные элементы интерфейса на каждом скриншоте. Размер задаётся параметром `h` (240…1080), `debug=1` выводит номер сцены и таймкод.
- `edit13.html` — динамичный эдит 1.3: ~25 с, 130 BPM, склейка на каждую долю (во втором дропе — на полдоли), удары зумом, вспышки, слова-титры. Музыка — `music-edit13.py` (фонк-набросок: ковбелл, 808 с глайдом).
- `corp13.html` — корпоративное промо 1.3: 50 с, светлый стиль. Проблема → решение → 4 блока (каталог, установка, обновления, интерфейс) с выносками на интерфейсе → сводка → призыв. Музыка — `music-corp13.py` (фортепиано и пэд, 100 BPM).
- Три ролика 1.3 в разных стилях, у каждого своя анимация и музыка (общий синтезатор — `synth.py`, numpy, 48 кГц):
  - `kinetic13.html` — кинетическая типографика: бумага, чёрный и красный, сетка из 12 колонок, склейки на долю и красные шторки между разделами; ~33 с. Музыка `music-kinetic13.py` — минимал-хаус 124 BPM, Fm, брейкдаун на SHA256.
  - `synth13.html` — синтвейв: неоновое солнце, бегущая сетка, хромированный логотип, ЭЛТ-монитор и VHS-глитчи на склейках; 34 с. Музыка `music-synth13.py` — 96 BPM, Am–F–C–G, арпеджио, октавный бас, гейтованный снейр.
  - `lofi13.html` — лоу-фай «уютный стол»: стикер со списком дел, полароиды, кружка, стоп-моушен на 12 кадрах в секунду, текст печатается; ~37 с. Музыка `music-lofi13.py` — 82 BPM, родес, свинг, винил и «плавание» плёнки; щелчки машинки, карандаш и бумага синхронно с кадром.
- `kinetic13-v.html`, `synth13-v.html`, `lofi13-v.html` — вертикальные версии этих трёх роликов для Shorts / Reels (1080×1920): тот же таймлайн и та же музыка, вёрстка под 9:16. Важное держится в безопасной зоне — ниже верхних 170 px, выше нижних 380 px (подпись и канал), левее кнопок справа; `safe=1` в `QUERY` подсвечивает закрытые интерфейсом зоны.
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

# Скриншоты для README (docs/screenshots/*.webp) — из кадров capture13
node promo/docs-screenshots.cjs

# 1.3 — эдит 360p
QUERY="h=360" OUT_SUFFIX=-360p CRF=24 node promo/render.cjs video edit13.html
python3 promo/music-edit13.py
ffmpeg -i promo/edit13-360p.mp4 -i promo/music-edit13.wav -c:v copy -af loudnorm=I=-12:TP=-1 -ar 48000 -c:a aac -b:a 128k -shortest promo/GetBox-1.3-edit-360p.mp4

# 1.3 — корпоративное промо 360p
QUERY="h=360" OUT_SUFFIX=-360p CRF=24 node promo/render.cjs video corp13.html
python3 promo/music-corp13.py
ffmpeg -i promo/corp13-360p.mp4 -i promo/music-corp13.wav -c:v copy -af loudnorm=I=-16:TP=-1.5 -ar 48000 -c:a aac -b:a 128k -shortest promo/GetBox-1.3-corporate-360p.mp4

# 1.3 — три стиля (720p со звуком)
for n in kinetic synth lofi; do
  QUERY="h=720&fps=60" OUT_SUFFIX=-720p CRF=20 node promo/render.cjs video $n'13.html'   # lofi: fps=30
  python3 promo/music-$n'13.py'
  ffmpeg -i promo/$n'13-720p.mp4' -i promo/music-$n'13.wav' -c:v copy -af loudnorm=I=-14:TP=-1 -ar 48000 -c:a aac -b:a 192k -shortest promo/GetBox-1.3-$n-720p.mp4
done

# 1.3 — три стиля для Shorts (1080×1920), музыка та же
for n in kinetic synth lofi; do
  QUERY="h=1920&fps=60" OUT_SUFFIX=-shorts CRF=20 node promo/render.cjs video $n'13-v.html'   # lofi: fps=30
  ffmpeg -i promo/$n'13-v-shorts.mp4' -i promo/music-$n'13.wav' -c:v copy -af loudnorm=I=-14:TP=-1 -ar 48000 -c:a aac -b:a 192k -shortest promo/GetBox-1.3-$n-shorts.mp4
done

# Shorts
node promo/render.cjs video shorts.html
python3 promo/music-shorts.py
ffmpeg -i promo/shorts.mp4 -i promo/music-shorts.wav -c:v copy -af loudnorm=I=-13:TP=-1 -ar 48000 -c:a aac -b:a 192k -shortest promo/GetBox-shorts.mp4
```

Нужны Playwright с Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` — если стоят не в стандартном месте) и ffmpeg с libx264.

- `promo.html` — сцены; `render(t)` задаёт состояние кадра по времени, поэтому рендер детерминированный. Тексты и тайминги — там же.
- `music.py`, `music-shorts.py`, `music13.py` — синтезированная музыка (96, 128 и 120 BPM, Am–F–C–G), без сторонних сэмплов.

`loudnorm` внутри работает на 192 кГц и без `-ar 48000` отдаёт AAC 96 кГц — многие плееры (браузеры, мессенджеры) такой звук молча не воспроизводят.
