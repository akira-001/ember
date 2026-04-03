"""Voice Chat Web App - STT (Whisper) + LLM (Ollama) + TTS (VOICEVOX)"""
import asyncio
import json
import tempfile
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response

from faster_whisper import WhisperModel

app = FastAPI()

VOICEVOX_URL = "http://localhost:50021"
VOICEVOX_SPEAKER = 2  # 四国めたん ノーマル

# --- Models (lazy load) ---
_whisper_model = None


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        print("Whisper large-v3 読み込み中...")
        _whisper_model = WhisperModel("large-v3", device="cpu", compute_type="int8")
        print("Whisper 準備完了")
    return _whisper_model


async def transcribe(audio_bytes: bytes) -> str:
    """音声バイト列をテキストに変換"""
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=True) as f:
        f.write(audio_bytes)
        f.flush()
        model = get_whisper()
        segments, info = model.transcribe(f.name, language="ja", beam_size=5)
        text = "".join(seg.text for seg in segments).strip()
    return text


async def chat_with_llm(messages: list[dict]) -> str:
    """Ollama でチャット応答を取得"""
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "gemma4:e4b",
                "messages": messages,
                "stream": False,
            },
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def synthesize_speech(text: str) -> bytes:
    """VOICEVOX でテキストを音声に変換"""
    async with httpx.AsyncClient(timeout=60) as client:
        # 1. 音声クエリ生成
        resp = await client.post(
            f"{VOICEVOX_URL}/audio_query",
            params={"text": text, "speaker": VOICEVOX_SPEAKER},
        )
        resp.raise_for_status()
        query = resp.json()

        # 2. 音声合成
        resp = await client.post(
            f"{VOICEVOX_URL}/synthesis",
            params={"speaker": VOICEVOX_SPEAKER},
            json=query,
        )
        resp.raise_for_status()
        return resp.content


@app.get("/")
async def index():
    html = (Path(__file__).parent / "index.html").read_text()
    return HTMLResponse(html)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    conversation: list[dict] = [
        {"role": "system", "content": (
            "あなたはフレンドリーな日本語の会話アシスタントです。"
            "音声会話なので、簡潔に2-3文で返答してください。"
        )}
    ]

    try:
        while True:
            # クライアントから音声データ受信
            data = await ws.receive_bytes()

            # STT
            await ws.send_json({"type": "status", "text": "文字起こし中..."})
            text = await transcribe(data)
            if not text:
                await ws.send_json({"type": "status", "text": "音声を認識できませんでした"})
                continue

            await ws.send_json({"type": "user_text", "text": text})

            # LLM
            await ws.send_json({"type": "status", "text": "考え中..."})
            conversation.append({"role": "user", "content": text})
            try:
                reply = await chat_with_llm(conversation)
            except Exception as e:
                conversation.pop()
                await ws.send_json({"type": "assistant_text", "text": f"[LLM エラー: {e}]"})
                continue
            conversation.append({"role": "assistant", "content": reply})

            # TTS (VOICEVOX)
            await ws.send_json({"type": "status", "text": "音声生成中..."})
            try:
                audio = await synthesize_speech(reply)
                await ws.send_json({"type": "assistant_text", "text": reply})
                await ws.send_bytes(audio)
            except Exception as e:
                # VOICEVOX 失敗時はテキストのみ返す（ブラウザTTSにフォールバック）
                await ws.send_json({"type": "assistant_text", "text": reply, "tts_fallback": True})

    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    get_whisper()
    uvicorn.run(app, host="0.0.0.0", port=8765)
