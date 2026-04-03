"""faster-whisper STT test script (large-v3)"""
import sys
import time
from faster_whisper import WhisperModel

def transcribe(audio_path: str):
    print("モデル読み込み中 (初回はダウンロードに数分かかる)...")
    t0 = time.time()
    model = WhisperModel("large-v3", device="cpu", compute_type="int8")
    print(f"モデル準備完了: {time.time() - t0:.1f}s")

    print(f"文字起こし中: {audio_path}")
    t0 = time.time()
    segments, info = model.transcribe(audio_path, language="ja", beam_size=5)

    print(f"検出言語: {info.language} (確信度: {info.language_probability:.2f})")
    print("---")
    for seg in segments:
        print(f"[{seg.start:.1f}s - {seg.end:.1f}s] {seg.text}")
    print(f"---\n処理時間: {time.time() - t0:.1f}s")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使い方: python scripts/test_stt.py <音声ファイルパス>")
        print("例: python scripts/test_stt.py test.wav")
        sys.exit(1)
    transcribe(sys.argv[1])
