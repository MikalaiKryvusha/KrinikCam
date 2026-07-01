> ✅ РЕАЛИЗОВАНО 2026-06-28 — в Settings → About: серая aux-строка с build-инфо
> («debug/release · vX.Y (build) · дата время»), тап по KrinikCam → диалог о проекте + ссылка
> GitHub, тап по Author → диалог с кликабельными ссылками (GitHub/Instagram/YouTube/Telegram
> @kotkrinik). Share log file есть во всех сборках. BUILD_TIME через buildConfigField. Проверено
> на устройстве (оба диалога). Файлы: `SettingsScreen.kt`, `app/build.gradle.kts`.

Фича:
- Расширить блок с информацией о приложении и авторе в Settings экране приложения
- Во всех типах сборок нужно писать тип сборки, релиз, дебаг, версию, номер билда, дата и время сборки - пусть пишется наглядно второй aux строкой серого цвета, как сейчас там текст написан в блоке KrinikCam.
- Пусть тапом по блоку KrinikCam открывается модальный диалог с расширенной информацией о проекте, со ссылкой на Github
- Пусть тапом по блоку Author открывается блок с расширенной информацией об авторе, с кликабельными ссылками на социальные сети криника
- Github - Mikalai Kryvusha
- Instagram - @kotkrinik
- YouTube - @kotkrinik
- Telegram - @kotkrinik

- Во всех типах сборок пусть будет Share log file