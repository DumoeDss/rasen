<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「ループではなく、螺旋」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="ライセンス: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://rasen.io/ja/docs/"><img alt="ドキュメント" src="https://img.shields.io/badge/docs-rasen.io-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-9A9A98?style=flat-square" /></a>
  <a href="./README_zh.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-9A9A98?style=flat-square" /></a>
  <a href="./README_ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-4AF626?style=flat-square&labelColor=050505" /></a>
  <a href="./README_ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-9A9A98?style=flat-square" /></a>
</p>

**Rasen** は、スペック駆動（spec-driven）の開発ワークフローの上に自律オーケストレーション・ハーネスを重ねたツールです——あなたがスペックを書けば、ハーネスが change を propose → apply → archive へと駆動し、作業が完了するまで自律的に反復します。

## 円ではなく、螺旋

出発点に戻るだけのループはただの円です。Rasen（螺旋）は、上昇していくループの形。それがこのツールの理念のすべてであり、実際の動作にそのまま対応しています：

- **スペックが原点。** すべての change は、コードを書く前に `rasen/` ワークスペースへ書き落とされた意図——提案、要件、設計、タスクリスト——から始まります。`/rasen:propose → apply → archive`。
- **ループが形。** 作業はウォーターフォールの一括通過ではなく、サイクルで進みます。`rasen` パイプラインファミリー——`small-feature`、`bug-fix`、`full-feature`、`auto-decompose`——がタスクを propose、implement、review、ship のループへと形づくります。
- **一周ごとに上昇。** ハーネスは単に繰り返すのではなく、前進します。`/rasen:auto` は LEAD を立ち上げ、役割分離されたサブエージェント、自らの誤りを捕捉するレビューサイクル、セッションをまたいでコンテキストを運ぶ handoff／リレーをオーケストレーションします——どの一周も、始まりより高いところで終わるように。
- **突破するまで。** `/rasen:goal` はドキュメントではなく条件で螺旋を閉じます：メトリクスを目標値まで押し上げる、モジュールをルーブリック合格まで磨く、ブリーフに答えが出るまでリサーチする——gate を満たすまで modify → judge を繰り返します。

スペックが出発点。螺旋が、そこへ至る道です。

## 系譜（Lineage）

Rasen は Fission-AI による [OpenSpec](https://github.com/Fission-AI/OpenSpec)（MIT）のフォークであり、[Sayo](https://github.com/DumoeDss) が独立してメンテナンスしています。**Fission-AI とは無関係です**。ワークフローのセマンティクスは上流 **OpenSpec v1.5.0** に整合しており——`propose → apply → archive` の spec/change モデルは同一です——ただし rasen は**独立した名前空間**で動作します：`rasen` バイナリ、`/rasen:*` スラッシュコマンド、`rasen-*` スキル、そして `rasen/` ワークスペース。rasen はその上に自律オーケストレーションを重ね、上流の `openspec/` インストールには決して触れません。

## インストール

**Node.js `>=20.19.0`** が必要です。

```bash
npm i -g @atelierai/rasen
```

次にプロジェクトで初期化します：

```bash
cd your-project
rasen init
```

`rasen init` は `rasen/` ワークスペース（specs と changes）を作成し、あなたの AI コーディングツールに `/rasen:*` スラッシュコマンドをインストールします。

アップグレード後に AI ガイダンスを更新し、最新のスラッシュコマンドを取り込むには：

```bash
rasen update
```

## OpenSpec との共存

Rasen は上流の OpenSpec と衝突せずに**共存**できるよう設計されています。すべてのインターフェースが独立した名前空間なので、同じプロジェクトに両方を同時にインストールできます：

| インターフェース | OpenSpec | Rasen |
| --- | --- | --- |
| バイナリ | `openspec` | `rasen` |
| スラッシュコマンド | `/opsx:*` | `/rasen:*` |
| スキル | `openspec-*` | `rasen-*` |
| ワークスペース | `openspec/` | `rasen/` |

名前空間が重なることはないため、rasen のインストールが既存の OpenSpec 環境を乱すことはありません——先にアンインストールすべきものは何もありません。

既存の `openspec/` ワークスペースを rasen に持ち込みたい場合は：

```bash
rasen migrate
```

`rasen migrate` は**コピーのみ（copy-only）**です：`openspec/{specs,changes,config.yaml}` を `rasen/` にコピーし、既に存在するものはスキップします。元の `openspec/` ディレクトリは**決して変更・削除されません**——OpenSpec でそのまま使い続けられます。

### chrome-use の前提条件

`chrome-use` エキスパートは Chrome DevTools Protocol 経由で、あなたが日常使っている Chrome を操作します。利用には以下が必要です：

- **Google Chrome** がインストール済みであること。
- **Node.js 22 以降**（CDP プロキシツールチェーンの要件）。
- リモートデバッグを有効にして Chrome を起動——`chrome://inspect/#remote-debugging` を開く（または `--remote-debugging-port` 付きで Chrome を起動）。
- **初回の CDP 接続**時、Chrome に **"Allow"** の許可ポップアップが表示されます——承認してツールの接続を許可してください。

## 得られるもの

- **スペック駆動ワークフロー** — すべての change は、提案・specs・設計・タスクリストを含む 1 つのフォルダです。コードを書く前に、何を作るかについて合意します：`/rasen:propose → /rasen:apply → /rasen:archive`。
- **`rasen` パイプラインファミリー** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose` がデータ（YAML）として同梱；`rasen pipeline show|list|classify|resume` で確認できます。タスクタイプの追加はファイル 1 つの追加、コードはゼロ。
- **`/rasen:auto` オートパイロット** — 1 つのコマンドでエージェントが **LEAD** となり、役割分離されたサブエージェント（planner / implementer / reviewer / fixer / shipper）をパイプラインに沿ってオーケストレーションし、gate でのみ停止します。
- **`/rasen:goal` ゴール駆動反復** — `/rasen:auto` の姉妹コマンド。「完了」がドキュメントではなく条件であるタスク向け（Lighthouse を 90 まで上げる、モジュールをルーブリック合格まで磨く、リサーチしてブリーフを書く）。LEAD がタスクを measure / evaluate / research バックエンドに分類し、gate を満たすかラウンド上限に達するまで modify → judge を繰り返します。
- **Auto-decompose** — 1 つのレビュー可能な diff に収まらない大きなタスクを、依存 DAG と保守的な直列／並列ポリシー付きで、独立してデリバリー可能な子 change に分割します。
- **chrome-use** — CDP 経由で実際の Chrome を操作するエキスパート：ナビゲート、クリック、ネットワークキャプチャ、JS 注入、cookie と `localStorage` の読み取り、リクエスト待機——ログインが必要なページ、SPA、素の fetch では届かないあらゆるものに。
- **コンテキスト感知と handoff** — `rasen agent context` が実際の占有率を測定；`/rasen:handoff` が蒸留チェックポイントを書き出し；worker はソフト予算で自己交代し、compact 復帰フックが auto-compact 後にセッションを蒸留物へ再アンカーします——長時間の実行がコンテキスト上限を生き延びるように。

## 動作イメージ

```text
You: /rasen:explore
AI:  何を探索しますか？
You: ダークモードを入れたいけど、きれいなやり方が分からない。
AI:  スタイリング構成を見てみます……
     最もクリーンな道：CSS 変数 + 小さなテーマ context、
     システム設定の検出付き。新しい依存はなし。スコープを決めますか？
You: うん、それでいこう。

You: /rasen:propose add-dark-mode
AI:  rasen/changes/add-dark-mode/ を作成しました
     ✓ proposal.md — なぜやるのか、何が変わるのか
     ✓ specs/       — 要件とシナリオ
     ✓ design.md    — 技術アプローチ
     ✓ tasks.md     — 実装チェックリスト
     実装の準備ができました！

You: /rasen:apply
AI:  タスクを実行中...
     ✓ 1.1 テーマ context プロバイダを追加
     ✓ 1.2 トグルコンポーネントを作成
     ✓ 2.1 CSS 変数を追加
     ✓ 2.2 localStorage を接続
     すべてのタスクが完了！

You: /rasen:archive
AI:  rasen/changes/archive/2026-01-23-add-dark-mode/ にアーカイブしました
     スペックを更新済み。次の機能の準備ができています。
```

## テレメトリとプライバシー

Rasen は、どのコマンドが使われているかを把握するために匿名の利用テレメトリを収集します。送信されるのは**コマンド名、rasen のバージョン、匿名 UUID、OS と Node のバージョンのみ**——**パス、引数、プロジェクトデータは一切送信されません**。

オプトアウトするには、いずれかを設定します：

```bash
export RASEN_TELEMETRY=0
# またはツール横断の標準：
export DO_NOT_TRACK=1
```

CI 環境ではテレメトリは**自動的に無効化**されます。

## ライセンス

MIT — Copyright (c) 2024 OpenSpec Contributors および Copyright (c) 2026 Sayo。[LICENSE](./LICENSE) を参照。

Issue とフィードバック：[github.com/DumoeDss/rasen](https://github.com/DumoeDss/rasen)。
