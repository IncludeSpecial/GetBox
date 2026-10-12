# Промо-ролик GetBox

40 с, 1920×1080, 30 fps. Кадры интерфейса — настоящий renderer GetBox на тестовых данных из `data/`.

```bash
npm run build                          # собрать dist/ (renderer)
node promo/capture.cjs                 # скриншоты интерфейса → promo/shots/
node promo/render.cjs stills 12 23.5   # (по желанию) отдельные кадры для проверки
node promo/render.cjs video            # покадровый рендер promo.html → promo/video.mp4
python3 promo/music.py                 # фоновая музыка → promo/music.wav (нужен numpy)
ffmpeg -i promo/video.mp4 -i promo/music.wav -c:v copy -c:a aac -b:a 192k -shortest promo/GetBox-promo.mp4
```

Нужны Playwright с Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` — если стоят не в стандартном месте) и ffmpeg с libx264.

- `promo.html` — сцены; `render(t)` задаёт состояние кадра по времени, поэтому рендер детерминированный. Тексты и тайминги — там же.
- `music.py` — синтезированный эмбиент (96 BPM, Am–F–C–G), без сторонних сэмплов.
