# 《47萬分之1》高中人生模擬 v0.1

你是 2026 年 8 月，全台 47 萬名高中、高職學生裡的一人。你不用打字，只負責做決定：名字、座號、縣市、學校、家庭、通勤都是抽到的。時間會自己往前跑，72 個回合（高一到高三）之後，系統才攤開你看不到的隱藏曲線。

v0.1 只做「普通高中」這條線。校名皆為虛構。事件機率來自設計稿的真實統計子集（交通事故），數字多為設計假設，不是預言。

## 在本機執行

純靜態網頁，沒有建置步驟、沒有 npm 相依套件、沒有外部 CDN。

```bash
python3 -m http.server 8000
# 瀏覽器開 http://localhost:8000
```

不能直接雙擊 index.html（`fetch` 讀資料需要 http）。網址加 `?seed=123` 可固定人生編號，加 `?ms=2000` 可把 1× 的單回合時間改成 2 秒（除錯用，預設 8000）。

測試與模擬（需要 Node 18+）：

```bash
node --test tests/
node tools/simulate.mjs 2000   # 自動玩 N 局，印結局分布、死亡率、平均理解、人生事件次數
```

## 資料夾結構

```
index.html            入口
css/style.css         淺色／深色主題（CSS 變數 + prefers-color-scheme），手機優先
js/main.js            控制器：時間流動、事件暫停、localStorage 存檔（key: wan47.save.v1）
js/ui.js              畫面元件
js/engine/            純函式引擎，不碰 DOM，可在 Node 使用
  rng.js              mulberry32、「命運骰」rngAt(seed, turn, 標籤)
  identity.js         開局抽籤
  state.js            狀態、存檔序列化
  turn.js             回合流程、習慣結算、日曆
  events.js           條件求值器（不用 eval）、兩段式抽卡、套用選擇
  life.js             真實機率的人生事件
  peers.js            999 個平行同儕
  report.js           學期報告、終局報告、SVG 小圖
data/                 identities / events / calendar / life_events（JSON）
tests/engine.test.mjs node:test
tools/simulate.mjs    批次模擬
```

## 設計重點

- 一局 = 種子 + 選擇。「同一個人生再來一次」會重用種子：同樣的身分、同樣的人生事件運氣（由 種子+回合+事件 決定，與選擇無關）。
- 學習 = 時間 × 專注 × 消化比例 × 興趣；專注由睡眠債、手機、牽掛、運動決定，且玩家只看得到模糊描述。
- 事件卡的 `effects` 是看得見的好處，`hidden` 是畢業才揭露的代價。

## 開啟 GitHub Pages

Settings → Pages → Build and deployment → Source 選 Deploy from a branch → Branch 選 `main` / `(root)` → Save。幾分鐘後即可在 `https://<帳號>.github.io/<repo>/` 遊玩。
