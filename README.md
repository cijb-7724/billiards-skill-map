# ビリヤード技能地図

ビリヤードの練習課題を、配置・撞点・速度・合格領域・物理シミュレーションと一緒に学べる教材サイトです。

## 設計方針

- ロードマップ原稿 `../roadmap_v4.tex` の全74課題を `app/roadmapTasks.json` へ変換
- 台上の座標は長辺8、短辺4のダイヤ単位。通常配置と合格領域は0.25目盛に統一
- `scripts/validate-drills.mjs` が課題数、球の重なり、座標、ポケット経路、長方形領域を検査
- 物理検証済みの課題だけ、真上とプレイヤー視点の3D再生・撞点・強さ変更を公開
- ホームでは使い方と全テーマのロードマップを一覧表示
- 過去問は通常カリキュラムと分離した専用ビューアへ順次収録
- テーマ一覧と課題表示はデスクトップ上で独立してスクロール
- 未検証課題は配置図と合格基準だけを表示し、誤った物理再生は行わない
- 撞点と強さを変更した場合は Web Worker 内のブラウザー物理モデルで毎回再計算
- 将来の課題PDFも同じJSONから生成する

現在は R0〜R4 の30課題について、基準ショット・微調整・弱いドローの3条件をブラウザー物理モデルで検証済みです。R3・R4ではさらに、指定クッションの接触順と、固定配置で動かしてはいけない次球も検査します。

## ローカル実行

```bash
pnpm install
node scripts/import-roadmap.mjs ../roadmap_v4.tex app/roadmapTasks.json
node --import tsx scripts/generate-roadmap-trajectories.ts
pnpm test
pnpm run dev
```

基準値を再探索するときは `pnpm run tune:r2` または `pnpm run tune:r3-r4` を使います。探索結果は自動では書き込まれないため、採用値を確認してから課題データへ反映します。

GitHub Pages用の静的ビルドは `pnpm run build:pages` です。
