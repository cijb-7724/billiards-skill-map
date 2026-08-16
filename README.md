# ビリヤード技能地図

ビリヤードの練習課題を、配置・撞点・速度・合格領域・物理シミュレーションと一緒に学べる教材サイトです。

## 設計方針

- 課題の正本は `app/drills.json`
- 台上の座標は長辺8、短辺4のダイヤ単位
- `scripts/validate-drills.mjs` が球の重なり、ポケット経路、クッション接触点、合格領域への到達を検査
- `scripts/simulate_drills.py` が pooltool 0.6 で軌道を生成し、入球と合格領域を再検査
- サイトは同じデータを読み、真上の課題図とプレイヤー視点3Dで軌道を再生
- 撞点と強さを変更した場合は Web Worker 内のブラウザー物理モデルで再計算
- ブラウザー計算は pooltool の基準軌道で校正し、同一ページ内の直近20結果だけ一時保持
- 将来の課題PDFも同じJSONから生成する

## ローカル実行

```bash
pnpm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/simulate_drills.py
pnpm test
pnpm run dev
```

GitHub Pages用の静的ビルドは `pnpm run build:pages` です。
