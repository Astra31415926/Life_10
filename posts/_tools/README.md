# Инструменты для постов (делает Claude)

render.py — рисует орнамент кодом сайта (index.html) в безголовом Chromium.
Запуск из корня репозитория:
  python3 -m http.server 8765 --bind 127.0.0.1 &   # сайт локально
  python3 posts/_tools/render.py <папка> '<json-задания>'
Задание: {"tag":"2026-11-10_ivan","word":"Іван","g":2,"i":1,"motif":"none","shape":"square","poster":true}
Виды по очереди: 1) g2 i1 square none (бирюзовый) 2) g2 i2 square rhomb (красно-синий) 3) g0 i1 cross rhomb (вышивка)
Для Instagram постер дополняется по бокам цветом листа до 4:5 (файл *_ig.png).
