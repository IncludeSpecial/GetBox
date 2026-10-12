# Промо-ролики GetBox

- `promo.html` — основной ролик: 40 с, 1920×1080, 30 fps.
- `shorts.html` — вертикальная версия для Shorts / Reels: 30 с, 1080×1920, 60 fps, монтаж по долям 128 BPM.

Кадры интерфейса — настоящий renderer GetBox на тестовых данных из `data/`.

```bash
npm run build                          # собрать dist/ (renderer)
node promo/capture.cjs                 # скриншоты интерфейса → promo/shots/
node promo/render.cjs stills promo.html 12 23.5   # (по желанию) отдельные кадры для проверки
node promo/render.cjs video promo.html            # покадровый рендер → promo/promo.mp4
python3 promo/music.py                 # фоновая музыка → promo/music.wav (нужен numpy)
ffmpeg -i promo/promo.mp4 -i promo/music.wav -c:v copy -c:a aac -b:a 192k -shortest promo/GetBox-promo.mp4

# Shorts
node promo/render.cjs video shorts.html
python3 promo/music-shorts.py
ffmpeg -i promo/shorts.mp4 -i promo/music-shorts.wav -c:v copy -af loudnorm=I=-13:TP=-1 -c:a aac -b:a 192k -shortest promo/GetBox-shorts.mp4
```

Нужны Playwright с Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` — если стоят не в стандартном месте) и ffmpeg с libx264.

- `promo.html` — сцены; `render(t)` задаёт состояние кадра по времени, поэтому рендер детерминированный. Тексты и тайминги — там же.
- `music.py`, `music-shorts.py` — синтезированная музыка (96 и 128 BPM, Am–F–C–G), без сторонних сэмплов.
