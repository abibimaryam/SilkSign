"""
Ishora — real-time imo-ishora (sign language) → matn web server.

Brauzer kameradan kadrlarni WebSocket orqali yuboradi, server ularni
demo.py dagi aynan o'sha quvur (letterbox + normalizatsiya) bilan tayyorlab,
MViT ONNX modeliga beradi va tanilgan so'zni (gloss) qaytaradi.

Ishga tushirish:
    .venv/bin/python server.py
    # so'ng brauzerda: http://localhost:8000
"""
import asyncio
import base64

import cv2
import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from omegaconf import OmegaConf

from constants import classes

# ----------------------------------------------------------------------------
# Model va konfiguratsiya
# ----------------------------------------------------------------------------
ort.set_default_logger_severity(4)
try:
    ort.preload_dlls()  # pip nvidia-cu12 paketlaridan CUDA/cuDNN ni yuklaydi (ort>=1.21)
except Exception:
    pass

conf = OmegaConf.load("config_example.yaml")

# GPU bo'lsa fp16 modelni CUDA'da, aks holda fp32 modelni CPU'da ishlatamiz.
import os

_has_cuda = "CUDAExecutionProvider" in ort.get_available_providers()
_fp16_path = "mvit32-2-fp16.onnx"
if _has_cuda and os.path.exists(_fp16_path):
    MODEL_PATH = _fp16_path
    PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
else:
    MODEL_PATH = conf.model_path
    PROVIDERS = ["CPUExecutionProvider"]

session = ort.InferenceSession(MODEL_PATH, providers=PROVIDERS)
print(f"ONNX provayder: {session.get_providers()[0]} | model: {MODEL_PATH}")
INPUT_NAME = session.get_inputs()[0].name
OUTPUT_NAMES = [o.name for o in session.get_outputs()]
WINDOW_SIZE = session.get_inputs()[0].shape[3]  # 32

MEAN = np.array(conf.mean, dtype=np.float32)
STD = np.array(conf.std, dtype=np.float32)


def resize(im, new_shape=(224, 224)):
    """Aspect ratio'ni saqlab letterbox bilan o'lchamni o'zgartirish (demo.py bilan bir xil)."""
    shape = im.shape[:2]
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]
    dw /= 2
    dh /= 2
    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    im = cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
    return im


def preprocess(frame_bgr):
    """Bitta BGR kadrni model uchun [3,224,224] tensorga aylantirish."""
    image = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = resize(image, (224, 224))
    image = (image - MEAN) / STD
    image = np.transpose(image, [2, 0, 1])
    return image


def predict(window):
    """32 ta kadr oynasidan gloss indeksini qaytaradi."""
    input_tensor = np.stack(window[:WINDOW_SIZE], axis=1)[None][None]
    outputs = session.run(OUTPUT_NAMES, {INPUT_NAME: input_tensor.astype(np.float32)})[0]
    return int(outputs.argmax())


# ----------------------------------------------------------------------------
# Web ilova
# ----------------------------------------------------------------------------
app = FastAPI(title="Ishora real-time")


@app.get("/")
async def landing():
    """Ishora landing page (DC runtime support.js orqali render bo'ladi)."""
    return FileResponse("Ishora.dc.html")


@app.get("/support.js")
async def support_js():
    return FileResponse("support.js", media_type="application/javascript")


@app.get("/demo")
async def demo():
    """Imo-ishora → matn jonli demosi."""
    return FileResponse("web/index.html")


@app.websocket("/ws")
async def ws_recognize(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    buffer = []          # tayyorlangan kadrlar oynasi
    sentence = []        # to'plangan so'zlar
    last_gloss = "---"
    alive = True

    async def infer_loop():
        nonlocal last_gloss
        while alive:
            if len(buffer) >= WINDOW_SIZE:
                window = buffer[:WINDOW_SIZE]
                del buffer[:WINDOW_SIZE]          # demo.py: clear_tensors
                idx = await loop.run_in_executor(None, predict, window)
                gloss = str(classes[idx])
                is_new = gloss != "---" and gloss != last_gloss
                if is_new:
                    sentence.append(gloss)
                    sentence[:] = sentence[-12:]  # oxirgi 12 ta so'z
                last_gloss = gloss
                try:
                    await websocket.send_json(
                        {"gloss": gloss, "sentence": " ".join(sentence), "is_new": is_new}
                    )
                except Exception:
                    break
            else:
                await asyncio.sleep(0.04)

    infer_task = asyncio.create_task(infer_loop())
    try:
        while True:
            data = await websocket.receive_text()
            if data == "__reset__":
                buffer.clear()
                sentence.clear()
                last_gloss = "---"
                await websocket.send_json({"gloss": "---", "sentence": "", "is_new": False})
                continue
            raw = base64.b64decode(data.split(",")[-1])
            arr = np.frombuffer(raw, np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is not None:
                buffer.append(preprocess(frame))
                # haddan ortiq orqada qolib ketmaslik uchun navbatni cheklaymiz
                if len(buffer) > WINDOW_SIZE * 3:
                    del buffer[:-WINDOW_SIZE]
    except WebSocketDisconnect:
        pass
    finally:
        alive = False
        infer_task.cancel()


# statik fayllar (ixtiyoriy qo'shimcha resurslar uchun)
app.mount("/web", StaticFiles(directory="web"), name="web")


if __name__ == "__main__":
    import uvicorn

    import os

    port = int(os.environ.get("PORT", "8010"))
    print(f"Model: {conf.model_path} | oyna: {WINDOW_SIZE} kadr | sinflar: {len(classes)}")
    print(f"Brauzerda oching:  http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
