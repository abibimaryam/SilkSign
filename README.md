# SilkSign (Ishora)

**SilkSign** — o'zbek imo-ishora tilini real vaqtda tanuvchi xizmat: kamera imo-ishorani suratga oladi, ONNX modeli uni tasniflaydi va ekranga matn chiqadi.

Veb-interfeys **Ishora** deb ataladi va brauzer orqali ishlaydi: veb-kameradan tushayotgan video WebSocket orqali serverga yuboriladi, u yerda kadrlar CLI-demoda ishlatiladigan xuddi o'sha oldindan tayyorlash (preprocessing) va model bilan qayta ishlanadi.

![demo](images/demo.gif)

## Qanday ishlaydi

1. Brauzer veb-kameradan kadrlarni oladi va ularni base64 JPEG ko'rinishida WebSocket (`/ws`) orqali yuboradi.
2. Server (`server.py`, FastAPI + Uvicorn) kadrni dekodlaydi, letterbox usulida 224×224 o'lchamga keltiradi, normallashtiradi va `WINDOW_SIZE` (model `mvit32-2` uchun 32) ta kadrdan iborat oynani to'playdi.
3. To'lgan oyna ONNX model orqali (`onnxruntime`, GPU mavjud bo'lsa CUDA, aks holda CPU) ishlaydi.
4. Bashorat qilingan sinf indeksi `constants.py` orqali so'zga moslashtiriladi (taxminan 1000 ta sinf: daktil harflar va so'z/imo-ishoralar) va to'plangan "gap" bilan birga mijozga qaytariladi.

Xuddi shu oldindan tayyorlash quvuri `demo.py` da ham ishlatiladi — brauzersiz, mahalliy veb-kamera bilan (OpenCV oynasi) ishlash uchun.

## Repozitoriy tuzilishi

| Yo'l | Vazifasi |
|---|---|
| `server.py` | FastAPI-server: landing sahifa, `/demo` (veb-mijoz), real vaqtdagi tanish uchun WebSocket `/ws` |
| `demo.py` | OpenCV asosidagi mustaqil CLI-demo (brauzersiz), multiprocessing opsiyasi bilan |
| `constants.py` | `classes` lug'ati — model indeksi → so'z/harf (o'zbek tilida) |
| `config_example.yaml` | Model konfiguratsiyasi: vazn fayli yo'li, kadr intervali, normallashtirish mean/std qiymatlari |
| `web/index.html` | Tanish demosining veb-mijozi (kamera olish, imo-ishora/gap chiqishi) |
| `Ishora.dc.html` | Loyihaning landing sahifasi |
| `support.js` | Landing sahifa runtime skripti |
| `examples/` | Inferens (ONNX/Torch) va landmarklarni vizualizatsiya qilish notebooklari |
| `sign language.md` | Loyihaning investorlar uchun taqdimot (pitch deck) hujjati |
| `license/` | Litsenziya matni (en/ru) |

## O'rnatish

Python 3.9+ talab qilinadi.

```bash
pip install -r requirements.txt
```

Model fayli (`.onnx`) repozitoriyga kiritilmagan (`.gitignore` ga qarang) — uni alohida yuklab olib, yo'lini konfigda ko'rsatish kerak. Bazaviy model — **MViTv2-small-32-2**, u [Slovo](https://github.com/hukenovs/slovo) datasetida o'qitilgan va o'zbek tili uchun qo'shimcha o'qitilgan (qarang: [Model](#model)).

Yuklab olingan faylni (masalan, `mvit32-2.onnx`) loyiha ildiziga joylashtiring va uning nomini `config_example.yaml` faylida (`model_path`) ko'rsating. CUDA mavjud bo'lib, yonida `mvit32-2-fp16.onnx` fayli topilsa, server va `demo.py` avtomatik ravishda GPU'da fp16 versiyasini ishlatadi.

## Ishga tushirish

### Veb-server (brauzerda WebSocket-demo)

```bash
python server.py
```

Server sukut bo'yicha `8010`-portda ko'tariladi (`PORT` muhit o'zgaruvchisi orqali o'zgartiriladi).

- `http://localhost:8010/` — landing sahifa
- `http://localhost:8010/demo` — veb-kameradan imo-ishorani jonli tanish

### CLI-demo (mahalliy kamera, OpenCV oynasi)

```bash
python demo.py -p config_example.yaml
```

```
usage: demo.py [-h] -p CONFIG [--mp] [-v] [-l LENGTH]

  -p, --config    model konfiguratsiyasi yo'li
  --mp            inferens uchun multiprocessing yoqish
  -v, --verbose   batafsil loglash (bashorat vaqti va h.k.)
  -l, --length    oxirgi tanilgan so'zlar navbati uzunligi
```

Chiqish — `q`, `Q` yoki `Esc` tugmasi.

## Konfiguratsiya

`config_example.yaml`:

```yaml
model_path: mvit32-2.onnx
frame_interval: 2   # model uchun har N-chi kadrni olish
mean: [123.675, 116.28, 103.53]
std: [58.395, 57.12, 57.375]
```

## Model

Tanish **MViTv2** arxitekturasiga asoslangan — u [Slovo](https://github.com/hukenovs/slovo) loyihasida (rus imo-ishora tili uchun dataset va baseline modellar, [arXiv:2305.14527](https://arxiv.org/abs/2305.14527)) va **SignFlow** modelida ishlatilgan. Sinflar lug'ati (`constants.py`) o'zbek imo-ishora tili uchun kengaytirilgan va lokalizatsiya qilingan — daktil alifbosi harflari va taxminan ming so'z.

## Ishlab chiqish

Formatlash va linting `pre-commit` orqali sozlangan (black, isort, flake8, autoflake):

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Litsenziya

Loyiha Slovo dataseti va modeliga asoslangan bo'lib, ular Creative Commons Attribution-ShareAlike 4.0 ning o'zgartirilgan versiyasi ostida tarqatiladi. To'liq matn — [`license/en_us.pdf`](license/en_us.pdf) va [`license/ru.pdf`](license/ru.pdf) fayllarida.
