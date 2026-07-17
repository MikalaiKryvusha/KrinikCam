---
name: kaif-version
description: Показать версию KAIF, развёрнутую в KrinikCam, и проверить origin-репозиторий фреймворка на новый релиз. Читает маркер .kaif/kaif.json (версия, дата релиза, origin, режим tracking). Вызывается когда Криник говорит «какая версия KAIF», «проверь версию KAIF», «есть ли обновление фреймворка», «kaif version», «check for KAIF updates».
---

# /kaif-version — версия развёрнутого KAIF и проверка обновлений

KAIF развёрнут (заинжектирован) в проект конкретной версией. Навык сообщает Кринику, какая версия в
проекте и есть ли новее в апстриме.

## Что делать

1. **Прочитай локальный маркер** `.kaif/kaif.json`:
   ```json
   { "framework": "KAIF", "version": "X.Y", "released": "YYYY-MM-DD",
     "origin": "https://github.com/MikalaiKryvusha/KAIF", "tracking": "origin", "sphere": "...", "agent": "..." }
   ```
   Доложи: текущая версия + дата релиза, режим `tracking` (`origin` или `fork`), sphere и agent.
   (Эквивалент: `node tools/kaif.mjs version`.)

2. **Проверь origin на новый релиз:**
   ```bash
   gh release view --repo MikalaiKryvusha/KAIF --json tagName,publishedAt 2>/dev/null \
     || gh api repos/MikalaiKryvusha/KAIF/releases/latest --jq '.tag_name + " " + .published_at'
   ```
   Сравни семвер-версии (`MAJOR.MINOR`).

3. **Доложи Кринику:**
   - Актуально → так и скажи.
   - Есть новее → скажи какая, и предложи: *«Вижу новую версию KAIF (vX.Y, ДАТА). Провести
     уважительное обновление и миграцию проекта?»* → при согласии передай в `/kaif-update`.
   - `tracking: fork` → отметь, что проект следует за собственным форком KAIF Криника, а не за
     официальным origin; обновления origin — информативно (вернуться: `/kaif-switch-origin`).

## Примечания
- Нет `.kaif/kaif.json` — возможно, KAIF здесь не развёрнут (или маркер потерян) — скажи об этом и
  укажи на `KAIF.md` origin-репозитория для (пере)развёртывания.
- Навык read-only: ничего в проекте не меняет. Обновление — через `/kaif-update`.
