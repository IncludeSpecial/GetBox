# GetBox

<p align="center">
  <img src="data/logo.svg" alt="GetBox" width="72" height="72" />
</p>

**Локальный магазин программ для Windows** в духе Steam Library.

Скачали `GetBox.exe` — готово. Курируемые приложения ставятся напрямую с официальных сайтов. Scoop, winget и Chocolatey поднимаются сами при первом запуске в `%LOCALAPPDATA%\GetBox\runtime\` — отдельно ничего ставить не нужно.

| | |
|---|---|
| Платформа | Windows x64 |
| Стек | Electron · React · TypeScript · Vite |
| Версия | 1.2.0 |
| Дистрибутив | Portable `.exe` (~70 МБ) |

---

## Возможности

- **Курируемый каталог** — витрина с иконками и описаниями; ссылки на установщики не хранятся вручную, а берутся из манифестов winget
- **Все пакеты** — индекс Scoop / winget / Chocolatey на отдельной вкладке
- **Очередь установок** — один install за раз, с прогрессом
- **Персональные рекомендации** — лента «Для вас» по установленному и избранному, «Часто ставят вместе» и «Альтернативы» в карточке программы
- **Избранное и профили** — быстрый старт наборами программ
- **RU / EN** — переключение языка в интерфейсе
- **Кастомный title bar** — без системного меню File / Edit / View
- **Очередь с отменой** — можно отменить загрузку/установку, повторить или убрать ошибку
- **Понятные ошибки** — 404, блокировка CDN/региона, сеть, таймаут (RU/EN)
- **Offline-first** — каталог работает сразу, runtime и метаданные догружаются в фоне
- **Проверка установщиков** — только HTTPS, SHA256 из манифеста winget сверяется до запуска, тип файла определяется по содержимому

## Провайдеры

| Провайдер | ID | Права | Описание |
|-----------|-----|-------|----------|
| **Каталог GetBox** | `catalog` | Не нужны | Курируемый offline-каталог; установщик качается напрямую по манифесту winget, при сбое — через winget |
| **Scoop** | `scoop` | Не нужны | Изолированный Scoop в `runtime\scoop\` |
| **winget** | `winget` | Не нужны* | Системный winget / App Installer |
| **Chocolatey** | `chocolatey` | UAC 1× | Опционально: кнопка «Разрешить установку» при первом запуске |

\* На старых Windows 10 может понадобиться обновить App Installer.

Провайдеры включаются и отключаются в **настройках**.

> **Не запускайте GetBox постоянно от администратора.** Официальный установщик Scoop отказывается работать в elevated-сессии; для Scoop используется zip-установка. Chocolatey запрашивает UAC только один раз.

## Скачать

Соберите portable-сборку или возьмите готовый артефакт из [Releases](../../releases) (если опубликованы):

```text
release/GetBox-1.2.0-portable.exe
```

Runtime не упакован внутрь exe — он ставится при первом запуске в `%LOCALAPPDATA%`, поэтому файл остаётся относительно лёгким.

## Первый запуск

1. Откройте GetBox — curated-каталог доступен сразу.
2. В фоне настраиваются Scoop и winget (индикатор внизу слева).
3. Для Chocolatey нажмите **Разрешить установку (UAC)** или **Пропустить**.
4. Выберите программу → GetBox скачает официальный installer и установит.

## Разработка

### Требования

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) 20+ (рекомендуется LTS)
- npm

### Установка и запуск

```bash
npm install
npm run electron:dev
```

### Сборка portable

```bash
npm run dist
```

Результат: `release/GetBox-1.2.0-portable.exe`.

### Скрипты

| Команда | Описание |
|---------|----------|
| `npm run electron:dev` | Dev-режим с HMR |
| `npm run build` | Сборка renderer + main + иконки |
| `npm run dist` | Portable Windows x64 |
| `npm run index` | Пересборка индекса пакетов (CLI) |
| `npm run prewarm` | Предзагрузка метаданных (CLI) |
| `npm test` | Проверка каталога + smoke |
| `npm run verify:catalog` | Только проверка `data/catalog.json` |
| `npm run catalog:installers` | Обновить `data/installers.json` из манифестов winget (Node 22.5+); `-- --check` только проверяет |
| `npm run lint` | ESLint |

### Откуда берутся установщики

В `data/catalog.json` только витрина: название, описание, категория, иконка. Как ставить программу, решает `data/installers.json`, сгенерированный `npm run catalog:installers` из официального индекса winget (`cdn.winget.microsoft.com`, тот же источник, что у клиента winget):

- **прямая загрузка** (113 программ) — URL, SHA256, тип и ключи тихой установки из манифеста. GetBox качает только по HTTPS, сверяет SHA256 и лишь потом запускает; при любом сбое ставит через winget;
- **только winget** — у программы есть лишь MSIX / portable-сборка (Teams, ImageGlass, Rufus);
- **другой менеджер** — записи вида `{ "provider": "chocolatey", "packageId": "filezilla" }` для программ, которых нет в winget. Их скрипт не трогает.

Связь «программа → winget Id» — в `data/winget-map.json`. Скрипт сверяет название пакета с каталогом и не даст подставить чужую программу из-за опечатки в Id.

Добавили программу: допишите её в `catalog.json` и `winget-overrides.json`, затем `npm run winget:map` и `npm run catalog:installers`.

Раз в неделю workflow `refresh-installers.yml` запускает этот скрипт и открывает PR с новыми версиями. Чтобы он мог создавать PR, в настройках репозитория включите *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*.

### Рекомендации

`src/recommend.ts` ранжирует программы каталога по тому, что у пользователя установлено и в избранном:

- **связки** из `data/related.json` и профили — «ставят вместе с …»;
- **альтернативы** — если браузер или менеджер паролей уже есть, остальные из группы опускаются в ленте;
- доля установленного по категориям и выбор редакции (`picks.json`, `recommended`).

Пока у пользователя ничего нет, лента показывает выбор редакции. В карточке программы — блоки «Часто ставят вместе» и «Альтернативы».

## Структура репозитория

```text
electron/     Main process, провайдеры, bootstrap, IPC, очередь установок
src/          React UI (витрина, очередь, настройки, i18n)
data/         Каталог, installers.json, related.json, категории, профили, иконки
scripts/      Иконки приложения, verify-catalog, smoke
release/      Артефакты electron-builder (в git обычно не коммитятся)
```

## Данные приложения

Всё пользовательское — в `%LOCALAPPDATA%\GetBox\`:

| Путь | Назначение |
|------|------------|
| `runtime\scoop\` | Изолированный Scoop |
| `runtime\winget\` | Fallback App Installer |
| `runtime\chocolatey\` | Chocolatey CLI (если разрешён) |
| `runtime-state.json` | Статус bootstrap |
| `package-index.json` | Индекс пакетов провайдеров |
| `web-meta\` | Кэш описаний |
| `web-images\` | Кэш иконок |
| `search-cache\` | Кэш поиска (~14 дней) |
| `downloads\` | Временные installer-файлы |

## Архитектура

- **PackageProvider** — общий интерфейс (`search`, `install`, `listInstalled`, `available`, `describe`)
- **Runtime bootstrap** — Scoop / winget / Chocolatey в `%LOCALAPPDATA%\GetBox\runtime\`
- **Catalog merge** — offline-first: curated + индекс + installed
- **Install queue** — сериализованная очередь установок
- **Meta enrich** — описания от провайдеров, логотипы из `icon-index` / favicon
- **getbox-media://** — протокол для локальных иконок

Витрина (главная, каталог, рекомендации) строится только из `data/catalog.json`. Всё, что нашли Scoop, winget и Chocolatey, живёт на вкладке **Все пакеты**.

