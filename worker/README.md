# 匿名統計（Cloudflare Worker）

讓標題畫面顯示「已有多少人畢業、多少人正在就讀」，並讓學期報告的「線上的同學」看到真實玩家的匿名動態。
沒有設定時，遊戲完全照常運作，只是不顯示這些數字。

## 老師要做的事（約 5 分鐘，只做一次）

1. 到 <https://dash.cloudflare.com> 註冊帳號（免費方案即可，不需信用卡）。
2. 登入後，點右上角頭像 → **My Profile** → **API Tokens** → **Create Token**。
3. 選範本 **Edit Cloudflare Workers**（Use template），再按 **Add more**／新增權限：
   - Account · **D1** · Edit
   - Account · **Workers KV Storage** · Edit
   
   其餘照預設，Account Resources 選你的帳號，建立後**複製 Token**（只會顯示一次）。
4. 到左側 **Workers & Pages** 總覽頁，右側可看到 **Account ID**，複製起來。
   第一次請順便在這個頁面點進去一次，依畫面選一個 workers.dev 子網域（若系統要求）。
5. 到 GitHub 的 `leway1980/47wan` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，新增兩個：
   - `CLOUDFLARE_API_TOKEN`：貼上第 3 步的 Token
   - `CLOUDFLARE_ACCOUNT_ID`：貼上第 4 步的 Account ID
6. 到 **Actions** → **deploy-stats** → **Run workflow**。

之後全部自動：建立資料庫與快取、部署、把伺服器網址寫進 `data/server.json`（機器人會自動提交一次「Set stats server URL」）。
等網站重新發布後，標題畫面就會出現人數。之後只要改 `worker/` 或 `js/engine/feedcodes.js`，推上 main 就會自動重新部署。

## 收集哪些資料

只在遊戲開始、每個學期結束、遊戲結束時，匿名送出：

- 隨機產生的遊戲代號（16 碼，每局一個，與人無關）
- 學期（1–6）、遊戲裡抽到的**虛構**縣市、校名、姓名
- 最多 2 個從固定清單挑出的事件代碼（例如「開始打工」「交往了」）
- 結局類型（國立大學／私立大學／科技大學／重考一年／未走到畢業）

沒有任何自由輸入的文字，也不記錄 IP、帳號或真實個資；伺服器會拒絕不符清單與格式的內容。
動態只保留最新 300 筆。「畢業」人數 = 已走到結局的局數 + 超過 3 天沒動靜的局數（與遊戲「離開三天自動走完」一致）；「就讀」= 3 天內仍有動靜、還沒結束的局數。

## 免費額度

| 項目 | 免費額度 | 本專案用量 |
| --- | --- | --- |
| Worker 請求 | 約 10 萬次／天 | 每局約 8 次，加上標題畫面快取 5 分鐘 |
| D1 讀取 | 500 萬列／天 | 每 5 分鐘一次快照，很少 |
| KV 寫入 | 1,000 次／天 | 排程每天 288 次 |

超過額度時 Cloudflare 會直接拒絕請求，遊戲照常運作，只是不顯示統計。

## 如何重設

- 清空統計：Cloudflare 後台 → Storage & Databases → D1 → `wan47` → Console，執行 `DELETE FROM games; DELETE FROM feed;`，約 5 分鐘內快照更新。
- 關閉功能：把 `data/server.json` 改回 `{ "url": "" }`。
- 完全移除：在後台刪除 Worker `wan47-stats`、D1 `wan47`、KV `wan47-snap`。

## 開發

- 測試：專案根目錄 `node --test tests/`（含 worker 邏輯，用 Node 內建 sqlite 假冒 D1）。
- 本機試跑：`cd worker && npm ci`，將 `wrangler.toml.template` 複製成 `wrangler.toml` 並把 `__D1_ID__`、`__KV_ID__` 換成任意值，執行 `npx wrangler d1 execute wan47 --local --file schema.sql` 與 `npx wrangler dev --local`。
