# Strava API 設定・運用レポート

> このプロジェクトで実装した Strava API の設定方法、制限回避策、および他プロジェクトへの転用手順をまとめたレポートです。

---

## 目次

1. [プロジェクト構成の概要](#1-プロジェクト構成の概要)
2. [Strava アプリの作成と初期設定](#2-strava-アプリの作成と初期設定)
3. [OAuth2 認証フロー](#3-oauth2-認証フロー)
4. [Strava API の制限とその対策](#4-strava-api-の制限とその対策)
5. [データベース設計（Supabase）](#5-データベース設計supabase)
6. [Python スクリプトによるデータ取得](#6-python-スクリプトによるデータ取得)
7. [Next.js Web アプリのアーキテクチャ](#7-nextjs-web-アプリのアーキテクチャ)
8. [環境変数の設定](#8-環境変数の設定)
9. [他プロジェクトへの転用手順](#9-他プロジェクトへの転用手順)
10. [トラブルシューティング](#10-トラブルシューティング)

---

## 1. プロジェクト構成の概要

このプロジェクトは **2層構成** になっている。

| 層 | 技術 | 用途 |
|---|---|---|
| Python スクリプト | Python 3 + requests | ローカルでの管理者向けデータ取得 |
| Web アプリ | Next.js + Supabase + Vercel | 複数アスリートの OAuth 認証 + データ管理 |

```
strava_analy/
├── .env                          # ルート環境変数（トークン等）
├── activity.py                   # シンプルなアクティビティ取得
├── strava_stats_2025.py          # 2025年データ一括取得スクリプト
├── strava_token.py               # トークン手動取得スクリプト
├── token.py                      # トークンヘルパー
└── get_tokens_web_app/           # Next.js Web アプリ
    ├── app/api/                  # API Routes
    │   ├── auth/route.ts         # OAuth 開始
    │   ├── callback/route.ts     # OAuth コールバック
    │   ├── fetch-data/route.ts   # データ取得トリガー
    │   ├── stats/route.ts        # 統計データ
    │   └── fetch-status/route.ts # 進捗確認
    ├── lib/
    │   ├── database.ts           # Supabase 操作
    │   ├── stravaDataFetcher.ts  # バッチ取得ロジック
    │   └── types.ts              # 型定義
    └── scripts/
        └── fetch_user_data.py    # 管理者用データ取得スクリプト
```

---

## 2. Strava アプリの作成と初期設定

### 2.1 Strava API アプリの作成

1. [https://www.strava.com/settings/api](https://www.strava.com/settings/api) にアクセス
2. 以下の情報を入力してアプリを作成:

| 項目 | 設定値 | 備考 |
|---|---|---|
| Application Name | 任意の名前 | ユーザーに表示される |
| Category | Data Importer 等 | 用途に合わせて選択 |
| Club | 任意 | 空欄でも可 |
| Website | アプリのURL | Vercel の URL 等 |
| Authorization Callback Domain | `localhost` (開発) / `your-app.vercel.app` (本番) | **重要: ドメインのみ、パスなし** |

3. 作成後、以下の認証情報を取得:
   - `Client ID`（数値）
   - `Client Secret`（英数字 40 文字）

### 2.2 Callback Domain の設定について

**注意:** Strava は Callback Domain としてドメイン名のみを受け付ける。パス（`/api/callback`）は含めない。

```
# 正しい設定
Authorization Callback Domain: localhost

# 誤った設定（パスを含めると動かない）
Authorization Callback Domain: localhost:3000/api/callback  ← NG
```

実際のリダイレクト URI（フルパス）はコード側で指定する。

### 2.3 スコープの選択

このプロジェクトで使用したスコープ:

| スコープ | 権限 | 用途 |
|---|---|---|
| `activity:read_all` | 全アクティビティ読み取り | プライベート活動も含む全データ取得 |
| `profile:read_all` | プロフィール全読み取り | アスリート情報の取得 |

**最小権限の原則:** 読み取りのみで十分なため `write` スコープは一切要求していない。

---

## 3. OAuth2 認証フロー

### 3.1 フロー全体図

```
ユーザー → Web App(/api/auth) → Strava 認証画面 → Web App(/api/callback) → Supabase 保存
```

### 3.2 ステップ詳細

#### Step 1: 認証 URL の生成 (`/api/auth`)

```
GET /api/auth?client_id=YOUR_ID&client_secret=YOUR_SECRET
```

生成される Strava 認証 URL:
```
https://www.strava.com/oauth/authorize
  ?client_id=192607
  &redirect_uri=http://localhost:3000/api/callback
  &response_type=code
  &approval_prompt=auto
  &scope=activity:read_all,profile:read_all
  &state={client_id}:{client_secret}
```

**ポイント:** `state` パラメータに `client_id:client_secret` を埋め込むことで、コールバック時に認証情報を引き回す。

#### Step 2: コールバック処理 (`/api/callback`)

Strava から以下が返ってくる:
```
GET /api/callback?code=XXXXX&state={client_id}:{client_secret}&scope=...
```

処理内容:
1. `state` パラメータから `client_id` と `client_secret` を取り出す
2. `code` を使ってアクセストークンを取得

```typescript
// トークン交換
const response = await fetch('https://www.strava.com/api/v3/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_id,
    client_secret,
    code,
    grant_type: 'authorization_code'
  })
});

// レスポンス
{
  access_token: "xxx",
  refresh_token: "yyy",
  expires_at: 1234567890,   // Unix タイムスタンプ
  athlete: { id, firstname, lastname, profile, ... }
}
```

3. トークン + アスリート情報を Supabase に保存
4. 成功ページにリダイレクト

### 3.3 トークンリフレッシュ

Strava のアクセストークンは **6時間で失効** する。

```python
# Python でのリフレッシュ実装
def refresh_token(client_id, client_secret, refresh_token):
    response = requests.post(
        'https://www.strava.com/api/v3/oauth/token',
        data={
            'client_id': client_id,
            'client_secret': client_secret,
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token
        }
    )
    return response.json()  # 新しい access_token, refresh_token, expires_at
```

**運用のポイント:** データ取得前に **必ずリフレッシュを実行** する。期限切れ途中でのエラーを防ぐ。

---

## 4. Strava API の制限とその対策

### 4.1 レート制限

Strava API には2種類のレート制限がある:

| 制限 | 上限 | リセット |
|---|---|---|
| 15分バケット | 600 リクエスト | 15分ごと |
| 日次バケット | 100,000 リクエスト | 毎日 UTC 0:00 |

#### 対策: バッチ処理 + ウェイト

```typescript
// stravaDataFetcher.ts より
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

// 10件ずつ並列取得し、バッチ間に 500ms のウェイト
for (let i = 0; i < detailIds.length; i += BATCH_SIZE) {
  const batch = detailIds.slice(i, i + BATCH_SIZE);
  const results = await Promise.all(
    batch.map(id => fetchActivityDetail(id, accessToken))
  );
  // ... 処理
  if (i + BATCH_SIZE < detailIds.length) {
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }
}
```

#### 対策: 条件付きAPI呼び出し

全アクティビティに対してdetail APIを呼ぶのではなく、必要な場合のみ呼ぶ:

```typescript
// achievement_count > 0 または comment_count > 0 の場合のみ詳細取得
const needsDetail = activity.achievement_count > 0 || activity.comment_count > 0;
if (needsDetail) {
  const detail = await fetchActivityDetail(activity.id, accessToken);
}
```

これにより API 呼び出し回数を大幅に削減できる。

### 4.2 Strava アスリート（ユーザー）の制限

#### 問題: プライベートアクティビティへのアクセス

Strava はデフォルトで活動を「フォロワーのみ」や「自分のみ」に設定できる。

**解決策:** `activity:read_all` スコープを要求する。このスコープがあれば、**認証したアスリート自身**のすべてのプライベート活動にアクセス可能。

#### 問題: 複数アスリートの管理

単一の Strava API アプリで複数のアスリートを管理する必要があった。

**解決策: 複合主キー設計**

```sql
-- tokens テーブル（複合主キー）
CREATE TABLE tokens (
  client_id    VARCHAR(255) NOT NULL,  -- Strava API アプリのID
  athlete_id   BIGINT       NOT NULL,  -- アスリートのID
  athlete_name VARCHAR(255),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at   BIGINT NOT NULL,
  client_secret TEXT NOT NULL,
  athlete_profile JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, athlete_id)  -- 複合主キー
);
```

これにより:
- 1つの API アプリで複数アスリートを管理可能
- 各アスリートが独自にOAuth認証を実施
- アスリートごとにトークンを独立して管理

### 4.3 Vercel タイムアウト制限

#### 問題

Vercel の Serverless Functions には実行時間制限がある:

| プラン | タイムアウト |
|---|---|
| Hobby | 10 秒 |
| Pro | 60 秒 |

大量のアクティビティ（数百件）を取得する場合、60秒でも不足することがある。

#### 対策1: 内部タイムアウト + 進捗管理

```typescript
// fetch-data/route.ts
export const maxDuration = 60; // Vercel Pro の上限を設定

// 8秒の内部タイムアウト（Vercel 10秒制限への対応）
const timeout = setTimeout(() => {
  isTimedOut = true;
}, 8000);

// fetch_status テーブルで進捗を追跡
await updateFetchStatus(athleteId, {
  status: 'fetching',
  current: processedCount,
  total: totalActivities
});
```

#### 対策2: 管理者用 Python スクリプト（根本的解決策）

タイムアウト問題の **根本的な解決策** は、ローカルで Python スクリプトを実行すること:

```bash
# ローカルで実行（タイムアウトなし）
cd get_tokens_web_app
python scripts/fetch_user_data.py
```

このスクリプトは:
1. Supabase から全アスリートのトークンを取得
2. 各アスリートのトークンをリフレッシュ
3. 全アクティビティを取得（時間制限なし）
4. 集計データを Supabase に保存
5. Web アプリが保存済みデータを表示

```python
# fetch_user_data.py の主要フロー
def process_user(token_data):
    # 1. トークンリフレッシュ
    new_tokens = refresh_access_token(
        token_data['client_id'],
        token_data['client_secret'],
        token_data['refresh_token']
    )

    # 2. 全アクティビティ取得（ページネーション）
    activities = []
    page = 1
    while True:
        batch = fetch_activities(new_tokens['access_token'], page, per_page=200)
        if not batch:
            break
        activities.extend(batch)
        page += 1

    # 3. 集計してSupabaseに保存
    stats = calculate_stats(activities)
    save_to_supabase(token_data['athlete_id'], stats)
```

### 4.4 ページネーション

Strava の `per_page` 最大値は **200件**。多数のアクティビティがある場合はページネーションが必要:

```python
def fetch_all_activities(access_token, after=None, before=None):
    activities = []
    page = 1

    while True:
        params = {
            'per_page': 200,  # 最大値
            'page': page
        }
        if after:
            params['after'] = after    # Unix タイムスタンプ
        if before:
            params['before'] = before  # Unix タイムスタンプ

        response = requests.get(
            'https://www.strava.com/api/v3/athlete/activities',
            headers={'Authorization': f'Bearer {access_token}'},
            params=params
        )

        batch = response.json()
        if not batch:
            break

        activities.extend(batch)
        page += 1

    return activities
```

---

## 5. データベース設計（Supabase）

### 5.1 テーブル構成

```sql
-- トークン管理テーブル
CREATE TABLE tokens (
  client_id       VARCHAR(255) NOT NULL,
  athlete_id      BIGINT       NOT NULL,
  athlete_name    VARCHAR(255),
  access_token    TEXT         NOT NULL,
  refresh_token   TEXT         NOT NULL,
  expires_at      BIGINT       NOT NULL,
  client_secret   TEXT         NOT NULL,
  athlete_profile JSONB,
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  PRIMARY KEY (client_id, athlete_id)
);

-- 統計データキャッシュテーブル
CREATE TABLE stats (
  athlete_id  BIGINT PRIMARY KEY,
  data        JSONB,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- データ取得状況追跡テーブル
CREATE TABLE fetch_status (
  athlete_id  BIGINT PRIMARY KEY,
  status      VARCHAR(50),   -- 'fetching' | 'completed' | 'error'
  current     INTEGER,       -- 処理済み件数
  total       INTEGER,       -- 全件数
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.2 Supabase の設定

1. [https://supabase.com](https://supabase.com) でプロジェクト作成
2. SQL Editor で上記スキーマを実行
3. Project Settings > API から以下を取得:
   - `Project URL`
   - `anon public` キー

---

## 6. Python スクリプトによるデータ取得

### 6.1 シンプルなアクティビティ取得（`activity.py`）

```python
import requests

ACCESS_TOKEN = 'your_access_token'

url = 'https://www.strava.com/api/v3/athlete/activities'
headers = {'Authorization': f'Bearer {ACCESS_TOKEN}'}
params = {'per_page': 200, 'page': 1}

response = requests.get(url, headers=headers, params=params)
activities = response.json()

for act in activities:
    print({
        'id':        act['id'],
        'name':      act['name'],
        'distance':  act['distance'],        # メートル
        'time':      act['moving_time'],     # 秒
        'elevation': act['total_elevation_gain'],
        'type':      act['sport_type'],
        'avg_hr':    act.get('average_heartrate'),
        'avg_speed': act.get('average_speed')  # m/s
    })
```

### 6.2 トークン取得（`strava_token.py`）

初回セットアップ時の手動トークン取得:

```python
import requests

CLIENT_ID     = 'your_client_id'
CLIENT_SECRET = 'your_client_secret'
CODE          = 'authorization_code_from_strava'

response = requests.post(
    'https://www.strava.com/api/v3/oauth/token',
    data={
        'client_id':     CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'code':          CODE,
        'grant_type':    'authorization_code'
    }
)

tokens = response.json()
print('Access Token: ', tokens['access_token'])
print('Refresh Token:', tokens['refresh_token'])
print('Expires At:   ', tokens['expires_at'])
```

---

## 7. Next.js Web アプリのアーキテクチャ

### 7.1 API Routes 一覧

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/auth` | GET | OAuth URL 生成・リダイレクト |
| `/api/callback` | GET | OAuth コールバック・トークン保存 |
| `/api/tokens` | GET/POST/DELETE | トークン CRUD |
| `/api/fetch-data` | POST | データ取得トリガー |
| `/api/stats` | GET/POST | 統計データ取得・保存 |
| `/api/fetch-status` | GET | データ取得進捗確認 |

### 7.2 データ取得の進捗管理

フロントエンドが polling でリアルタイム進捗を表示:

```typescript
// フロントエンドの polling ロジック
const pollFetchStatus = async (athleteId: number) => {
  const interval = setInterval(async () => {
    const status = await fetch(`/api/fetch-status?athlete_id=${athleteId}`);
    const data = await status.json();

    setProgress(data.current / data.total * 100);

    if (data.status === 'completed') {
      clearInterval(interval);
      loadStats();
    }
  }, 2000); // 2秒ごとにポーリング
};
```

---

## 8. 環境変数の設定

### 8.1 Python スクリプト用（`.env`）

```bash
STRAVA_CLIENT_ID=192607
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_ACCESS_TOKEN=your_access_token
STRAVA_REFRESH_TOKEN=your_refresh_token
```

### 8.2 Next.js Web アプリ用（`.env.local`）

```bash
# Strava（ユーザーが OAuth 時に提供するため、デフォルト値）
STRAVA_CLIENT_ID=your_default_client_id
STRAVA_CLIENT_SECRET=your_default_client_secret

# リダイレクト URI
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/callback  # 開発
# NEXT_PUBLIC_REDIRECT_URI=https://your-app.vercel.app/api/callback  # 本番

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 8.3 Vercel 本番環境の設定

Vercel Dashboard > Settings > Environment Variables に追加:

```
NEXT_PUBLIC_SUPABASE_URL        = https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = your_anon_key
NEXT_PUBLIC_REDIRECT_URI        = https://your-app.vercel.app/api/callback
```

---

## 9. 他プロジェクトへの転用手順

### Step 1: Strava API アプリの作成

1. [https://www.strava.com/settings/api](https://www.strava.com/settings/api) でアプリ作成
2. `Client ID` と `Client Secret` を取得
3. Callback Domain を設定（ドメインのみ、パスなし）

### Step 2: Supabase プロジェクトの作成

1. [https://supabase.com](https://supabase.com) でプロジェクト作成
2. `get_tokens_web_app/schema_updated.sql` の SQL を実行
3. `Project URL` と `anon key` を取得

### Step 3: Web アプリのデプロイ

```bash
# リポジトリをクローン or get_tokens_web_app をコピー
cd get_tokens_web_app

# 依存関係インストール
npm install

# 環境変数を設定
cp .env.example .env.local
# .env.local を編集

# ローカル起動確認
npm run dev

# Vercel にデプロイ
npx vercel --prod
```

### Step 4: アスリートの OAuth 認証

1. ブラウザで `http://localhost:3000` にアクセス
2. Client ID と Client Secret を入力
3. 「Connect with Strava」をクリック
4. Strava の認証画面で許可
5. トークンが Supabase に保存される

### Step 5: データ取得

#### Web UI から:
- ダッシュボードの「Fetch Data」ボタンをクリック
- 進捗バーで状況を確認

#### ローカルスクリプトから（推奨）:
```bash
cd get_tokens_web_app
pip install requests python-dotenv supabase
python scripts/fetch_user_data.py
```

### Step 6: Python スクリプト単体で使う場合

OAuth なしでシンプルに使う場合:

```bash
# 1. Strava でアプリ作成後、ブラウザで以下URLにアクセス
https://www.strava.com/oauth/authorize?client_id=YOUR_ID&redirect_uri=http://localhost&response_type=code&scope=activity:read_all

# 2. リダイレクト先URLの code= パラメータをコピー

# 3. strava_token.py の CODE に貼り付けて実行
python strava_token.py

# 4. 出力されたトークンを .env に設定
# 5. スクリプトを実行
python activity.py
```

---

## 10. トラブルシューティング

### エラー: `Authorization Error` / `redirect_uri_mismatch`

**原因:** Callback Domain が Strava アプリ設定と一致していない

**対処:**
- Strava アプリ設定の `Authorization Callback Domain` を確認
- `localhost` のみ設定（ポートやパスは不要）
- 本番は `your-app.vercel.app` のようにドメインのみ

### エラー: `Rate Limit Exceeded` (HTTP 429)

**原因:** 15分または日次のレート制限に到達

**対処:**
```python
import time

def api_request_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        response = requests.get(url, headers=headers)

        if response.status_code == 429:
            wait_time = 60 * (attempt + 1)  # 60秒, 120秒, 180秒
            print(f"Rate limited. Waiting {wait_time}s...")
            time.sleep(wait_time)
            continue

        return response
    raise Exception("Max retries exceeded")
```

### エラー: `Invalid Token` / `Unauthorized` (HTTP 401)

**原因:** アクセストークンが期限切れ（6時間で失効）

**対処:** データ取得前に必ずリフレッシュを実行:
```python
# fetch_user_data.py が自動的にリフレッシュを実行
# 手動の場合:
new_tokens = refresh_access_token(client_id, client_secret, refresh_token)
access_token = new_tokens['access_token']
```

### エラー: Vercel タイムアウト

**原因:** 大量のアクティビティ取得が 60 秒を超える

**対処:** ローカルで管理者スクリプトを実行:
```bash
python get_tokens_web_app/scripts/fetch_user_data.py
```

### エラー: `Forbidden` (HTTP 403) - アクティビティが見えない

**原因:** `activity:read_all` スコープが付与されていない

**対処:** OAuth 認証をやり直し、スコープを `activity:read_all,profile:read_all` で要求する。既存のトークンでスコープは変更できないため、再認証が必要。

---

## まとめ: このプロジェクトで解決した主要課題

| 課題 | 解決策 |
|---|---|
| アクセストークンの期限切れ（6時間） | データ取得前の強制リフレッシュ |
| Vercel のタイムアウト制限 | ローカル Python スクリプトをバイパスとして使用 |
| レート制限（15分 600 req） | バッチ処理（10件並列）+ 500ms ウェイト |
| 不要なAPI呼び出しの削減 | achievement_count > 0 の場合のみ詳細取得 |
| 複数アスリートの管理 | 複合主キー（client_id + athlete_id）による設計 |
| プライベート活動へのアクセス | `activity:read_all` スコープの要求 |
| Vercel のファイルシステム制限 | Supabase によるデータベースファースト設計 |

---

*このレポートは `/Users/rimpeihata/Desktop/strava_analy` プロジェクトのコードベースを分析して生成しました。*
