# Travel Expense Manager

旅行後にMacで支出をまとめて入力・編集し、総額、カテゴリ別、通貨別、支払者別、同行者別負担、割り勘精算を確認するための静的Webアプリです。

## 方針

- React + TypeScript + Vite
- build後の `dist/` を通常のWebサーバーへアップロードして動作
- データ保存はブラウザのLocalStorage
- Safariを必須対応、Chromeも可能な範囲で対応
- ユーザー認証、クラウド同期、写真添付、位置情報、為替レート自動取得はMVP対象外

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

生成された `dist/` を静的ホスティングへ配置してください。
