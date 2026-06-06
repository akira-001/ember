#!/usr/bin/env python3
"""MLX vs Ollama 比較ベンチ — Qwen3.5 27B 4bit を Apple Silicon 上で計測。

目的: 「Apple Silicon で MLX(=Unsloth/LM Studio バックエンド) は Ollama より
メモリ効率・速度が良いか」を実機で裏取りする。

計測項目（同一プロンプト・同一 max tokens・greedy で公平化）:
  - generation 速度 (tok/s)
  - prompt processing 速度 (tok/s)  ← 長文プロンプトで測る
  - ピークメモリ (GB)
      * MLX   : mlx_lm.generate 自己申告の "Peak memory"（Metal アロケーション峰値）
      * Ollama: 推論中の runner プロセス RSS 峰値 + `ollama ps` の SIZE

usage: python3 tests/model_bench/bench_mlx_vs_ollama.py
"""
import json
import re
import subprocess
import threading
import time
import urllib.request

OLLAMA_API = "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = "qwen3.5:27b-q4_K_M"
MLX_MODEL = "mlx-community/Qwen3.5-27B-4bit"
MAX_TOKENS = 512

# 短プロンプト→長生成（生成速度・ピークメモリ用）
PROMPT_GEN = (
    "次の問いに日本語で詳しく答えて。"
    "Apple Silicon の unified memory アーキテクチャが LLM 推論で有利な理由を、"
    "メモリ帯域・ゼロコピー・量子化の観点から具体的に説明して。"
)
# 長プロンプト→短生成（prompt processing 速度用）。約2000トークン相当の文脈を与える。
_FILLER = (
    "ローカル LLM 推論では、モデルの重み・KV キャッシュ・アクティベーションが"
    "メモリを占有する。量子化は重みのビット幅を削減し、フットプリントを縮小する。"
) * 60
PROMPT_PP = _FILLER + "\n\n以上を1文で要約して。"


def _sample_rss_peak(stop_evt, out, pattern="ollama runner"):
    """pattern にマッチするプロセスの RSS(KB) 峰値を out['peak_kb'] に記録。"""
    peak = 0
    while not stop_evt.is_set():
        try:
            pids = subprocess.run(
                ["pgrep", "-f", pattern], capture_output=True, text=True
            ).stdout.split()
            total = 0
            for pid in pids:
                rss = subprocess.run(
                    ["ps", "-o", "rss=", "-p", pid], capture_output=True, text=True
                ).stdout.strip()
                if rss:
                    total += int(rss)
            peak = max(peak, total)
        except Exception:
            pass
        time.sleep(0.2)
    out["peak_kb"] = peak


def ollama_ps_size():
    out = subprocess.run(["ollama", "ps"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if OLLAMA_MODEL.split(":")[0] in line:
            return line.strip()
    return out.strip()


def run_ollama(prompt, label):
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": MAX_TOKENS, "seed": 42},
    }).encode()
    req = urllib.request.Request(OLLAMA_API, data=body,
                                headers={"Content-Type": "application/json"})
    stop = threading.Event()
    mem = {"peak_kb": 0}
    t = threading.Thread(target=_sample_rss_peak, args=(stop, mem))
    t.start()
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=900) as r:
        data = json.loads(r.read())
    wall = time.time() - t0
    stop.set(); t.join()
    ec = data.get("eval_count", 0)
    ed = data.get("eval_duration", 1) / 1e9
    pc = data.get("prompt_eval_count", 0)
    ped = data.get("prompt_eval_duration", 1) / 1e9
    return {
        "label": label,
        "gen_tok_s": ec / ed if ed else 0,
        "pp_tok_s": pc / ped if ped else 0,
        "out_tokens": ec,
        "prompt_tokens": pc,
        "wall": wall,
        "peak_mem_gb": mem["peak_kb"] / 1024 / 1024,
        "response": (data.get("response") or "").strip(),
    }


def run_mlx(prompt, label):
    cmd = [
        "mlx_lm.generate",
        "--model", MLX_MODEL,
        "--prompt", prompt,
        "--max-tokens", str(MAX_TOKENS),
        "--temp", "0.0",
    ]
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    wall = time.time() - t0
    out = p.stdout + "\n" + p.stderr
    # mlx_lm.generate のメトリクス行をパース
    pp = re.search(r"Prompt:\s+([\d.]+)\s+tokens,\s+([\d.]+)\s+tokens-per-sec", out)
    gen = re.search(r"Generation:\s+([\d.]+)\s+tokens,\s+([\d.]+)\s+tokens-per-sec", out)
    peak = re.search(r"Peak memory:\s+([\d.]+)\s+GB", out)
    # 生成本文（メトリクス出力の前まで）
    body = out.split("==========")
    resp = body[1].strip() if len(body) >= 3 else out[:400]
    return {
        "label": label,
        "gen_tok_s": float(gen.group(2)) if gen else 0,
        "pp_tok_s": float(pp.group(2)) if pp else 0,
        "out_tokens": int(float(gen.group(1))) if gen else 0,
        "prompt_tokens": int(float(pp.group(1))) if pp else 0,
        "wall": wall,
        "peak_mem_gb": float(peak.group(1)) if peak else 0,
        "response": resp[:600],
        "raw_metrics": out[-400:] if not gen else None,
    }


def main():
    results = {"ollama": {}, "mlx": {}}
    tasks = [("gen", PROMPT_GEN), ("pp", PROMPT_PP)]

    print(f"{'='*64}\nOLLAMA: {OLLAMA_MODEL}\n{'='*64}", flush=True)
    # warmup（ロード時間を計測から除外）
    run_ollama("こんにちは", "warmup")
    print("ollama ps ->", ollama_ps_size(), flush=True)
    for tid, prompt in tasks:
        r = run_ollama(prompt, tid)
        results["ollama"][tid] = r
        print(f"  [{tid:3}] gen {r['gen_tok_s']:6.1f} tok/s | "
              f"pp {r['pp_tok_s']:7.1f} tok/s | peakRSS {r['peak_mem_gb']:5.2f} GB | "
              f"in {r['prompt_tokens']}tok out {r['out_tokens']}tok", flush=True)

    print(f"\n{'='*64}\nMLX: {MLX_MODEL}\n{'='*64}", flush=True)
    run_mlx("こんにちは", "warmup")  # ダウンロード/コンパイルを除外
    for tid, prompt in tasks:
        r = run_mlx(prompt, tid)
        results["mlx"][tid] = r
        print(f"  [{tid:3}] gen {r['gen_tok_s']:6.1f} tok/s | "
              f"pp {r['pp_tok_s']:7.1f} tok/s | peakMem {r['peak_mem_gb']:5.2f} GB | "
              f"in {r['prompt_tokens']}tok out {r['out_tokens']}tok", flush=True)
        if r.get("raw_metrics"):
            print("    [warn] metrics parse miss; tail:", r["raw_metrics"], flush=True)

    # サマリ
    print(f"\n\n{'#'*64}\n# SUMMARY — Qwen3.5 27B 4bit / M5 Max\n{'#'*64}")
    print(f"{'metric':22} {'Ollama(GGUF)':>16} {'MLX':>12} {'MLX有利度':>12}")
    rows = [
        ("gen tok/s",  "gen", "gen_tok_s", True),
        ("prompt proc tok/s", "pp", "pp_tok_s", True),
        ("peak mem GB (gen)", "gen", "peak_mem_gb", False),
    ]
    for label, tid, key, higher_better in rows:
        o = results["ollama"][tid][key]
        m = results["mlx"][tid][key]
        if higher_better:
            adv = f"{(m/o-1)*100:+.0f}%" if o else "n/a"
        else:
            adv = f"{(1-m/o)*100:+.0f}% 少" if o else "n/a"
        print(f"{label:22} {o:16.2f} {m:12.2f} {adv:>12}")

    with open("tests/model_bench/results_mlx_vs_ollama.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nfull results -> tests/model_bench/results_mlx_vs_ollama.json")


if __name__ == "__main__":
    main()
