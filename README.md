# ビリヤード技能地図

ビリヤードの練習課題を、配置・撞点・速度・合格領域・物理シミュレーションと一緒に学べる教材サイトです。

## 設計方針

- 課題の正本は `app/drills.json`
- 台上の座標は長辺8、短辺4のダイヤ単位
- `scripts/validate-drills.mjs` が球の重なり、ポケット経路、クッション接触点、合格領域への到達を検査
- `scripts/simulate_drills.py` が pooltool 0.6 で軌道を生成し、入球と合格領域を再検査
- サイトは同じデータを読み、Canvas上で軌道を再生
- 将来の課題PDFも同じJSONから生成する

## ローカル実行

```bash
pnpm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/simulate_drills.py
pnpm run validate:drills
pnpm run dev
```

GitHub Pages用の静的ビルドは `pnpm run build:pages` です。
