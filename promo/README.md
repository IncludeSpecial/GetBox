# Промо-ролики GetBox

- `promo.html` — основной ролик: 40 с, 1920×1080, 30 fps.
- `promo13.html` — ролик о версии 1.3: 45 с, 120 BPM, 12 сцен по раскадровке. Размер задаётся параметром `h` (240…1080), `debug=1` выводит номер сцены и таймкод.
- `shorts.html` — вертикальная версия для Shorts / Reels: 30 с, 1080×1920, 60 fps, монтаж по долям 128 BPM.

Кадры интерфейса — настоящий renderer GetBox на тестовых данных из `data/`.

```bash
npm run build                          # собрать dist/ (renderer)
node promo/capture.cjs                 # скриншоты интерфейса → promo/shots/
node promo/render.cjs stills promo.html 12 23.5   # (по желанию) отдельные кадры для проверки
node promo/render.cjs video promo.html            # покадровый рендер → promo/promo.mp4
python3 promo/music.py                 # фоновая музыка → promo/music.wav (нужен numpy)
ffmpeg -i promo/promo.mp4 -i promo/music.wav -c:v copy -c:a aac -b:a 192k -shortest promo/GetBox-promo.mp4

# 1.3 — черновик 240p для проверки (скриншоты 1.3 лежат в promo/shots/13/)
QUERY="h=240&debug=1" OUT_SUFFIX=-240p CRF=28 node promo/render.cjs video promo13.html
python3 promo/music13.py
ffmpeg -i promo/promo13-240p.mp4 -i promo/music13.wav -c:v copy -c:a aac -b:a 96k -shortest promo/GetBox-1.3-preview-240p.mp4
# 1.3 — финал: QUERY="h=1080" node promo/render.cjs video promo13.html

# Shorts
node promo/render.cjs video shorts.html
python3 promo/music-shorts.py
ffmpeg -i promo/shorts.mp4 -i promo/music-shorts.wav -c:v copy -af loudnorm=I=-13:TP=-1 -c:a aac -b:a 192k -shortest promo/GetBox-shorts.mp4
```

Нужны Playwright с Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` — если стоят не в стандартном месте) и ffmpeg с libx264.

- `promo.html` — сцены; `render(t)` задаёт состояние кадра по времени, поэтому рендер детерминированный. Тексты и тайминги — там же.
- `music.py`, `music-shorts.py`, `music13.py` — синтезированная музыка (96, 128 и 120 BPM, Am–F–C–G), без сторонних сэмплов.
