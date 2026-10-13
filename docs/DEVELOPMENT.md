# Разработка GetBox

← [README](../README.md)


## Требования

- Windows 10/11 x64
- [Node.js](https://nodejs.org/) 20+ (рекомендуется LTS)
- npm

## Установка и запуск

```bash
npm install
npm run electron:dev
```

## Сборка portable

```bash
npm run dist
```

Результат: `release/GetBox-<версия>-portable.exe`.

## Скрипты

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

## Откуда берутся установщики

В `data/catalog.json` только витрина: название, описание, категория, иконка. Как ставить программу, решает `data/installers.json`, сгенерированный `npm run catalog:installers` из официального индекса winget (`cdn.winget.microsoft.com`, тот же источник, что у клиента winget):

- **прямая загрузка** (113 программ) — URL, SHA256, тип и ключи тихой установки из манифеста. GetBox качает только по HTTPS, сверяет SHA256 и лишь потом запускает; при любом сбое ставит через winget;
- **только winget** — у программы есть лишь MSIX / portable-сборка (Teams, ImageGlass, Rufus);
- **другой менеджер** — записи вида `{ "provider": "chocolatey", "packageId": "filezilla" }` для программ, которых нет в winget. Их скрипт не трогает.

Связь «программа → winget Id» — в `data/winget-map.json`. Скрипт сверяет название пакета с каталогом и не даст подставить чужую программу из-за опечатки в Id.

Добавили программу: допишите её в `catalog.json` и `winget-overrides.json`, затем `npm run winget:map` и `npm run catalog:installers`.

Раз в неделю workflow `refresh-installers.yml` запускает этот скрипт и открывает PR с новыми версиями. Чтобы он мог создавать PR, в настройках репозитория включите *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*.

## Рекомендации

`src/recommend.ts` ранжирует программы каталога по тому, что у пользователя установлено и в избранном:

- **связки** из `data/related.json` и профили — «ставят вместе с …»;
- **альтернативы** — если браузер или менеджер паролей уже есть, остальные из группы опускаются в ленте;
- доля установленного по категориям и выбор редакции (`picks.json`, `recommended`).

Пока у пользователя ничего нет, лента показывает выбор редакции. В карточке программы — блоки «Часто ставят вместе» и «Альтернативы».

## Выпуск релиза

1. Поднимите `version` в `package.json` и добавьте раздел `## X.Y.Z` в `CHANGELOG.md`.
2. После слияния в `main` поставьте тег `git tag vX.Y.Z && git push origin vX.Y.Z` — или запустите workflow **Release** вручную на вкладке *Actions*: тег `v<версия из package.json>` создастся сам.
3. Workflow `release.yml` на `windows-latest` прогонит проверки, соберёт `GetBox-X.Y.Z-portable.exe`, посчитает `GetBox-X.Y.Z-portable.exe.sha256` и опубликует релиз «GetBox X.Y.Z» с разделом из `CHANGELOG.md`.
4. Добавьте карточки для экрана «Что нового» в `data/whats-new.json` (ключ — версия), иначе после обновления экран не покажется.
5. Сайт [getbox.ne-nas.ru](https://getbox.ne-nas.ru/) подхватит релиз сам: последний шаг workflow просит [GetBoxLanding](https://github.com/IncludeSpecial/GetBoxLanding) пересобраться (нужен секрет `LANDING_DISPATCH_TOKEN`), без секрета сайт обновится в течение часа.

Самообновление берёт только релизы с ассетом `GetBox-*-portable.exe` и скачивает его, лишь если есть `.sha256` (или `digest` ассета от GitHub). Пре-релизы получают пользователи канала «Бета». Не удаляйте `.sha256` из релизов: без него клиенты не обновятся.

## Проверки на Windows и диагностика

- `GetBox.exe --smoke` открывает окно, ждёт отрисовки интерфейса, проверяет каталог и ошибки в консоли и выходит с кодом 0 или 1; с `GETBOX_SMOKE_OUT=путь.json` пишет результат в файл. Сеть в этом режиме не используется.
- `node scripts/test-windows.cjs` (на других ОС пропускается): скрипт замены exe при самообновлении на настоящем `cmd.exe`, передача аргументов через `cmd`, разбор реального вывода `choco outdated` и `winget upgrade`. В CI его запускает задание `windows` вместе со сборкой и `--smoke`.
- Журнал — `%LOCALAPPDATA%\GetBox\logs\getbox.log` (`electron/log.ts`): `console.warn/error` main-процесса, сбои процессов, шаги самообновления. Пишите в него через `logger('область')`.
- Команды менеджеров пакетов идут через `cmd.exe`, поэтому собирайте их только через `shellCommand()` из `electron/providers/shell-args.ts`, а пользовательский ввод пропускайте через `cleanQuery()`.

## Структура репозитория

```text
electron/     Main process, провайдеры, bootstrap, IPC, очередь, обновления, самообновление
src/          React UI (витрина, очередь, настройки, i18n)
data/         Каталог, installers.json, related.json, категории, профили, иконки
scripts/      Иконки приложения, verify-catalog, smoke
docs/         Документация и скриншоты для README
promo/        Исходники промо-роликов (см. promo/README.md)
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
- **Updates** (`electron/updates/`) — `winget upgrade`, `scoop status`, `choco outdated`, история и откат
- **Self-update** (`electron/self-update/`) — проверка релизов GitHub, загрузка с проверкой SHA256, подмена portable-exe после выхода

Витрина (главная, каталог, рекомендации) строится только из `data/catalog.json`. Всё, что нашли Scoop, winget и Chocolatey, живёт на вкладке **Все пакеты**.

