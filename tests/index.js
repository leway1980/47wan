// Node 22 之後 `node --test tests/` 會把目錄當成模組路徑；這個入口讓它在 Node 18–22 都能執行。
import('./engine.test.mjs');
