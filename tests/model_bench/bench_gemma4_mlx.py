#!/usr/bin/env python3
"""gemma4 MLX ベンチマーク（bench_gemma4.py の Ollama 版と対になる MLX 版）。

mlx_lm.stream_generate の最終 GenerationResponse から
  - prompt 処理速度: prompt_tps  (Ollama の prompt_eval ~ TTFT に対応)
  - 生成速度: generation_tps     (Ollama の eval_count/eval_duration に対応)
  - ピークメモリ: peak_memory
  - 総レイテンシ: wall
を測定する。プロンプト・温度・max_tokens・seed は Ollama 版と同一。

usage: python3 tests/model_bench/bench_gemma4_mlx.py
"""
import json
import time

import mlx.core as mx
from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler

# Ollama 版とサイズ/量子化を対応させた MLX モデル
MODELS = [
    ("gemma-4-e4b-4bit", "mlx-community/gemma-4-e4b-it-4bit"),
    ("gemma-4-26b-a4b-4bit(OptiQ)", "mlx-community/gemma-4-26B-A4B-it-OptiQ-4bit"),
]

# bench_gemma4.py と同一プロンプト
PROMPTS = [
    {"id": "conv_empathy", "label": "会話/共感",
     "prompt": "今日は疲れたよ。明日も朝から会議が3つある。\n親しい秘書として2文以内で短く返して。"},
    {"id": "reasoning", "label": "推論",
     "prompt": "次の問いに答えて、理由も一行で。\n太郎は花子より背が高い。花子は次郎より背が高い。一番背が高いのは誰？"},
    {"id": "summarize", "label": "要約",
     "prompt": "次を30字以内の日本語で要約して:\n『四半期の売上は前年同期比12%増となったが、円安による原材料高で営業利益率は2ポイント低下した。来期は価格改定で利益率の回復を見込む。』"},
    {"id": "instruction", "label": "指示追従",
     "prompt": "次の3つの予定を、開始時刻の早い順に『HH:MM タイトル』の形式で箇条書きにして。それ以外は出力しない。\n- 15:00 顧客MTG\n- 09:30 朝会\n- 13:00 ランチ面談"},
    {"id": "knowledge", "label": "知識",
     "prompt": "ストルバイト結石の猫の食事で気をつける点を3つ、簡潔に箇条書きで。"},
]

MAX_TOKENS = 1024
TEMP = 0.3


def run(model, tokenizer, sampler, prompt):
    messages = [{"role": "user", "content": prompt}]
    text = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
    t0 = time.time()
    last = None
    out = []
    for resp in stream_generate(model, tokenizer, text, max_tokens=MAX_TOKENS, sampler=sampler):
        out.append(resp.text)
        last = resp
    wall = time.time() - t0
    return {
        "wall": wall,
        "prompt_tps": getattr(last, "prompt_tps", 0.0),
        "gen_tps": getattr(last, "generation_tps", 0.0),
        "prompt_tokens": getattr(last, "prompt_tokens", 0),
        "out_tokens": getattr(last, "generation_tokens", 0),
        "peak_mem_gb": getattr(last, "peak_memory", 0.0),
        "response": "".join(out).strip(),
    }


def main():
    results = {}
    for label, repo in MODELS:
        print(f"\n{'='*60}\nMODEL: {label}  ({repo})\n{'='*60}", flush=True)
        mx.random.seed(42)
        try:
            model, tokenizer = load(repo)
        except Exception as e:
            print(f"  [skip] load failed: {e}", flush=True)
            results[label] = None
            continue
        sampler = make_sampler(temp=TEMP)
        results[label] = {}
        # warmup（モデルロード後のグラフ構築コストを除外）
        run(model, tokenizer, sampler, "こんにちは")
        for p in PROMPTS:
            mx.random.seed(42)
            try:
                r = run(model, tokenizer, sampler, p["prompt"])
            except Exception as e:
                print(f"  [{p['id']}] ERROR: {e}", flush=True)
                continue
            results[label][p["id"]] = r
            ans = r["response"] or "(空)"
            print(f"  [{p['label']:6}] {r['gen_tps']:6.1f} tok/s  "
                  f"prompt {r['prompt_tps']:7.1f} tok/s  total {r['wall']:5.2f}s  "
                  f"out {r['out_tokens']}tok  mem {r['peak_mem_gb']:.2f}GB", flush=True)
            print(f"           ans-> {ans[:100].replace(chr(10),' / ')}", flush=True)
        del model, tokenizer
        mx.clear_cache()

    print(f"\n\n{'#'*60}\n# SUMMARY  (平均 生成tok/s / 平均 total / peak mem)\n{'#'*60}")
    print(f"{'model':30} {'avg gen tok/s':>14} {'avg total':>10} {'peak mem':>10}")
    for label, _ in MODELS:
        rr = results.get(label)
        if not rr:
            print(f"{label:30} {'N/A':>14}")
            continue
        vals = list(rr.values())
        avg_ts = sum(v["gen_tps"] for v in vals) / len(vals)
        avg_tot = sum(v["wall"] for v in vals) / len(vals)
        peak = max(v["peak_mem_gb"] for v in vals)
        print(f"{label:30} {avg_ts:14.1f} {avg_tot:9.2f}s {peak:8.2f}GB")

    with open("tests/model_bench/results_gemma4_mlx.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nfull results -> tests/model_bench/results_gemma4_mlx.json")


if __name__ == "__main__":
    main()
