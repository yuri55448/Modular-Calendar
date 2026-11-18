import { FixedSlot, PERIOD_KINDS, PeriodKind } from "./types";

export interface PeriodicCfg {
  /** 根資料夾，例如 Daily */
  folder: string;
  /** 根資料夾下的子資料夾格式，例如 YYYY 或 YYYY/MM；留空 = 直接放在根資料夾 */
  subfolder: string;
  /** 檔名格式（見設定頁的說明） */
  format: string;
  /** 模板路徑（不含 .md 亦可）；留空則建立空白筆記 */
  template: string;
}

export interface SeasonDef { name: string; start: number; end: number; }

export const SEASON_PRESETS: Record<string, { label: string; seasons: SeasonDef[] }> = {
  standard: {
    label: "北半球四季（3–5 春、6–8 夏、9–11 秋、12–2 冬）",
    seasons: [
      { name: "春季", start: 3, end: 5 }, { name: "夏季", start: 6, end: 8 },
      { name: "秋季", start: 9, end: 11 }, { name: "冬季", start: 12, end: 2 },
    ],
  },
  southern: {
    label: "南半球四季（9–11 春、12–2 夏、3–5 秋、6–8 冬）",
    seasons: [
      { name: "春季", start: 9, end: 11 }, { name: "夏季", start: 12, end: 2 },
      { name: "秋季", start: 3, end: 5 }, { name: "冬季", start: 6, end: 8 },
    ],
  },
  tropical: {
    label: "熱帶兩季（11–4 乾季、5–10 雨季，範例）",
    seasons: [{ name: "乾季", start: 11, end: 4 }, { name: "雨季", start: 5, end: 10 }],
  },
};

/** 三種檢視（月曆／週曆／日曆）各自的格子高度 */
export interface Heights { month: number; week: number; day: number; }
export type HeightView = keyof Heights;
export type HeightPlace = "side" | "main";

export const DEFAULT_HEIGHTS: Heights = { month: 84, week: 150, day: 320 };
export const MIN_CELL_HEIGHT = 52;
/** 拖曳調整的上限：新分頁沒有實際上限（要多高都可以）；側邊欄月曆 180、週曆／日曆 600 */
export const maxCellHeight = (place: HeightPlace, view: HeightView) => (place === "main" ? 5000 : view === "month" ? 180 : 600);

/** 取得／設定某個位置（側邊欄或新分頁）、某種檢視的格子高度 */
export const cellHeightOf = (s: CalendarSettings, place: HeightPlace, view: HeightView) => s.heights[place][view];
export function setCellHeight(s: CalendarSettings, place: HeightPlace, view: HeightView, h: number) {
  s.heights[place][view] = Math.max(MIN_CELL_HEIGHT, Math.min(maxCellHeight(place, view), Math.round(h)));
}

/** 經過了多少年／月／日 */
export interface Elapsed { y: number; m: number; d: number; }

/** notes = 日記（既有日／週／月記等）；extra = 筆記（額外來源讀到的 .md）；tasks = 任務 */
export type ContentFilter = "notes" | "extra" | "tasks";
export interface UiState {
  /** day 日曆（單日）｜week 週曆｜month 月曆｜year 年歷｜timeline 月時間軸｜yearTimeline 年時間軸（年歷與年時間軸只有在新分頁開啟的月曆才會出現） */
  mode: "day" | "week" | "month" | "year" | "timeline" | "yearTimeline";
  scope: "day" | "week" | "month" | "year";
  content: ContentFilter;
  /** 下方「日記／筆記」清單的排序：名稱或檔名裡的日期（YYYY-MM-DD），小到大／大到小 */
  notesSort: "none" | "nameAsc" | "nameDesc" | "dateAsc" | "dateDesc";
  /** 下方「任務」清單的排序（剩餘時間＝離到期日還有幾天；名稱時間＝去掉開頭日期後的文字，相同的排在一起） */
  taskSort: "none" | "nameAsc" | "nameDesc" | "dateAsc" | "dateDesc" | "remainAsc" | "remainDesc" | "nameTimeAsc" | "nameTimeDesc";
  /** 下方「任務」清單的篩選：文字（任務名稱、檔名、路徑、日期都會比對）與來源 */
  taskFilter: string;
  taskSource: "all" | "normal" | "custom";
  /** 時間軸裡每天的任務排序 */
  timelineTaskSort: "none" | "az" | "za";
  /** 時間軸要顯示全部、只顯示日記、只顯示額外來源的筆記，還是只顯示任務清單 */
  timelineFilter: "all" | ContentFilter;
}

// ── 圓點 ──
export type DotShape = "circle" | "square" | "diamond" | "x" | "custom";
export interface MarkCfg {
  mode: "dots" | "number";
  shape: DotShape;
  /** shape = custom 時使用的單一 Unicode 字元 */
  custom: string;
  /** "" = 跟隨 Obsidian 主題色 */
  color: string;
  /** 數字顯示時，是否在旁邊也顯示一個圓點 */
  beside: boolean;
  /** order = 併入「顯示順序」可調整的插槽（預設）；fixed = 固定在當日格子左下角（舊版行為） */
  position: "order" | "fixed";
  /** 圓點模式下最多顯示幾點，超過改顯示數字 */
  maxDots: number;
  /** 根據格子大小自動把圓點換成數字顯示（格子太小放不下設定的點數時） */
  autoSize: boolean;
  /** 只讀取這些 md 檔案／資料夾裡的筆記來計算（可多個）；留空＝預設來源（日記、額外來源，任務圓點另含事項/任務日記） */
  paths: string[];
}

// ── 字體與大小 ──
export type Block = "title" | "info" | "weekday" | "weeknum" | "solar" | "lunar" | "tag" | "note" | "badge" | "panel";
export const BLOCKS: { id: Block; label: string; base: string }[] = [
  { id: "title", label: "年月日標題（含星期幾）", base: "calc(var(--font-ui-medium) * 1.15)" },
  { id: "info", label: "季節／季度／農曆年月日", base: "var(--font-ui-small)" },
  { id: "weekday", label: "星期表頭與「週」", base: "var(--font-ui-small)" },
  { id: "weeknum", label: "週數與週統計", base: "var(--font-ui-small)" },
  { id: "solar", label: "月曆裡的公曆數字", base: "var(--font-ui-medium)" },
  { id: "lunar", label: "農曆日期", base: "var(--font-ui-small)" },
  { id: "tag", label: "節慶／節氣／假日文字", base: "var(--font-ui-smaller)" },
  { id: "note", label: "YAML 自訂文字", base: "var(--font-ui-smaller)" },
  { id: "badge", label: "休／班徽章", base: "10px" },
  { id: "panel", label: "下方清單與時間軸", base: "var(--font-ui-small)" },
];
export type SizeMode = "default" | "compact" | "custom";
export interface BlockFont {
  /** "global" 跟隨全域｜"theme" 跟隨 Obsidian｜"sys" 系統字型（fonts.systemName）｜"imp:<id>" 已導入字體 */
  family: string;
  size: SizeMode;
  px: number;
}
export interface ImportedFont { id: string; name: string; file: string; }

// ── 節慶 ──
export interface HolidayEntry { date: string; name: string; isRest: boolean; isMakeupWork: boolean; }

export interface CalendarSettings {
  /** 0=週日 … 6=週六 */
  weekStart: number;
  /** 季度起始月（1 = 一般日曆季度；4 = 4 月起算的財年） */
  quarterStartMonth: number;
  /** 月曆可以往回／往前瀏覽到哪一年：default = 不特別限制；custom = 限制到 startDate 那一天 */
  startDate: { mode: "default" | "custom"; date: string; elapsed: Elapsed };
  /** 週六、週日公曆數字的顏色；空字串＝跟隨主題（預設紅色） */
  weekendColor: string;
  /** 標題日期旁顯示星期幾 */
  showTitleWeekday: boolean;
  /** 標題「2026年9月28日」要用中文，還是國際常見的「28 Sep 2026」 */
  titleFormat: "zh" | "intl";
  /** 標題第二列是否顯示「另一份年月日」（預設關閉） */
  showAltDate: boolean;
  /**
   * 另一份年月日的內容：lunar＝國家的農曆年月日；national＝國家的年曆（預設，例如日本令和8年、台灣民國115年，
   * 該國沒有自己的紀年時不顯示）；custom＝自訂：從 startDate 起算，加上已經過了 elapsed 的時間，每天往後推算
   */
  altDate: { mode: "lunar" | "national" | "custom"; name: string; startDate: string; elapsed: Elapsed };
  /** 開啟／建立筆記時：在新分頁（預設）或目前分頁 */
  openIn: "tab" | "current";
  /** 假日名稱太長時，依格子寬度自動換行（預設開啟） */
  holidayNameWrap: boolean;
  /** 標題第二列是否顯示季節／第幾季度（預設關閉） */
  showSeasonQuarter: boolean;
  /** 星期表頭的顯示風格 */
  weekdayStyle: "zh" | "en3" | "en2" | "en1" | "ja";

  disabledModules: string[];
  /** 已經處理過的格內模塊 id（用來判斷哪些是新版才加入的模塊） */
  knownModules: string[];
  /** 有固定位置的插槽（左上、右上、左下…）各放哪些模塊、先後順序 */
  layout: Record<FixedSlot, string[]>;
  /** 日期下方資訊區：每個元素是「一列」，列內可以有一個或多個模塊（由左到右）；列與列由上到下 */
  infoRows: string[][];

  periodic: Record<PeriodKind, PeriodicCfg>;
  naming: {
    /** 檔名格式含 {{name}} 時：none 不填｜template 取模板檔名｜prompt 建立時詢問 */
    nameMode: "none" | "template" | "prompt";
    /** 右鍵選單提供「創建新日記」（可與既有日記並存） */
    extraEnabled: boolean;
    extraFormat: string;
    /** 雙擊建立日記前是否彈出確認 */
    confirmDblClick: boolean;
  };
  templates: {
    /** 建立後交給 Templater 處理 <% %> 語法（需安裝 Templater）；對所有使用模板的週期筆記都適用 */
    templater: boolean;
  };
  /** 事項/任務日記建立時可選用的模板路徑；可以設多個，多個時建立前會跳出挑選器 */
  taskTemplates: string[];
  taskAdd: {
    /** 新增任務預設加到「事項/任務日記」還是一般日記 */
    target: "taskDiary" | "daily";
    /** 可以插入的標題（含 # 或 ##），可設多個，第一個是預設；空陣列＝直接加在檔案最後 */
    headings: string[];
    /** 用 Tasks 外掛的樣式新增任務（若有安裝 Tasks 外掛） */
    tasksStyle: boolean;
    /** 「新增任務（Tasks 樣式）」前可以挑選的存放位置（md 檔案或資料夾，可多個） */
    locations: string[];
  };
  /**
   * 自訂事項／任務：用表單建立（重複、時刻、次數、結束方式…）。「長期」的存放在 storage 指定的位置（根資料夾、依年／月的子資料夾、檔名格式），
   * 「當日」的直接寫進事項/任務日記。
   */
  customItems: {
    storage: { root: string; sub: "none" | "year" | "yearMonth"; fileFormat: string };
    /** 建立時自訂的其他存放路徑（md 檔案或資料夾）：除了根資料夾，也會一併讀取這些位置 */
    extraPaths: string[];
    /** 表單模板的存放位置（資料夾，留空＝根目錄），模板存在裡面的「自訂事項模板.md」 */
    templatesFolder: string;
    /** 事項在月曆裡的排序 */
    sort: "az" | "za" | "file";
    /** 事項文字顏色；空字串＝跟隨主題 */
    color: string;
    /** 完成記錄：key＝「編號|日期|時刻」→ 已完成次數 */
    done: Record<string, number>;
  };
  /** 月曆每天格子裡顯示的內容（「月曆內容」按鈕） */
  dayItems: {
    show: { notes: boolean; tasks: boolean; items: boolean };
    /** 最多顯示幾筆，超過顯示「還有 N 筆記錄」；0＝依格子大小自動 */
    max: number;
    /** 已完成的任務也列出 */
    showDone: boolean;
  };
  /** 任務旁邊有日期時，在清單裡顯示「剩下 N 天」，任務被勾選後就不再顯示 */
  taskDeadline: {
    enabled: boolean;
    /** 要辨識的日期寫法，每個一行，例如 YYYY-MM-DD、截止 YYYY/MM/DD、[due] YYYY-MM-DD（要原樣比對的文字用 [] 包起來） */
    formats: string[];
    /** 到期日（📅）：還沒到／當天／已逾期；{n} 換成天數 */
    textFuture: string;
    textToday: string;
    textOverdue: string;
    /** 開始日（🛫）：還沒到／當天 */
    textStartFuture: string;
    textStartToday: string;
    /** 預定日（⏳，沒有到期日時才顯示）：還沒到／當天／已過 */
    textScheduledFuture: string;
    textScheduledToday: string;
    textScheduledPast: string;
    /** 空字串＝跟隨主題 */
    color: string;
    overdueColor: string;
  };

  seasonPreset: string;
  seasonCustom: string;

  holiday: {
    source: "none" | "tw" | "jp" | "us" | "cn" | "custom" | "other";
    /** source = other 時的 ISO 3166-1 國碼（Nager.Date） */
    country: string;
    /** 導入的 JSON 節慶；不論選哪個來源都會與下載的資料疊加（同一天以此為準） */
    custom: Record<string, HolidayEntry>;
  };

  /** 今日公曆數字的底色；空字串＝跟隨主題（預設的強調色圓角底）。跟「選取日框顏色」放在同一處設定 */
  todayColor: string;
  /** 選取日的外框顏色；空字串＝跟隨主題強調色 */
  selectedColor: string;
  restWorkBadge: {
    restLabel: string;
    workLabel: string;
    /** inside = 格子內；border = 騎在格子上邊框 */
    position: "inside" | "border";
    /** 徽章在那一列（inside 或 border）裡水平靠左、置中，還是靠右 */
    align: "left" | "center" | "right";
    /** 自訂徽章文字草稿：需按「保存應用」才會真的生效（見 customSaved） */
    custom: string;
    /** 目前真正套用中的自訂徽章文字；跟 custom 不同代表「尚未保存應用」 */
    customSaved: string;
    priority: "custom" | "standard";
    /** 同一天可能有好幾個徽章一起命中，這裡決定「假日底色」要用哪一個的顏色：陣列順序＝優先序，最前面的優先 */
    bgPriority: string[];
    /**
     * 每個徽章標籤（含「休」「班」與自訂徽章裡出現過的其他標籤，以標籤文字本身當 key）：
     * color/opacity 是徽章本身（小標籤）的底色；bgColor/bgOpacity 是「假日底色」整格背景用的顏色
     */
    badgeColors: Record<string, { color: string; opacity: number; bgColor: string; bgOpacity: number }>;
  };
  noteMarks: {
    diary: MarkCfg;
    task: MarkCfg;
    /** 任務清單還有沒完成的任務時，不顯示一般圓點，改顯示「符號＋未完成數量」（例如 ⚠ 1）；全部完成就變回 task 的圓點樣式 */
    taskPending: { symbol: string; color: string };
  };
  weekStats: {
    enabled: boolean;
    mode: "dots" | "number";
    showTasks: boolean;
  };


  fonts: {
    imported: ImportedFont[];
    global: string;
    systemName: string;
    blocks: Record<Block, BlockFont>;
  };

  panelEnabled: boolean;
  /** 下方清單一次顯示幾列，超過就捲動；0＝自動根據底下欄框（視窗剩餘高度）調整 */
  panelRows: number;
  /** 週曆：week＝顯示選取日所在的那一週（含週數）；today＝最左邊是今天，往後共七天 */
  weekView: { display: "week" | "today" };
  /** 月曆／週曆／日曆每格的高度（px）：側邊欄與新分頁各自獨立，三種檢視也各自獨立 */
  heights: { side: Heights; main: Heights };
  ui: UiState;
  cache: { holiday: Record<string, HolidayEntry[]>; holidayMeta?: Record<string, number> };

  /** 每個日期格與週數欄之間的網格線 */
  gridLines: { enabled: boolean; color: string; width: number };

  /**
   * 額外來源：日記圓點／任務圓點／時間軸除了讀取既有的日／週／月記，也可以再掃描這裡列出的資料夾／檔案。
   * 這些筆記不需要符合日記的檔名格式，而是靠 YAML 裡的 dateKey 屬性（用 dateFormat 解析）判斷屬於哪一天。
   */
  extraSources: {
    enabled: boolean;
    paths: string[];
    dateKey: string;
    dateFormat: string;
  };
}

const blocks = () => {
  const o = {} as Record<Block, BlockFont>;
  for (const b of BLOCKS) o[b.id] = { family: "global", size: "default", px: 14 };
  return o;
};

export const DEFAULT_SETTINGS: CalendarSettings = {
  weekStart: 0,
  quarterStartMonth: 1,
  startDate: { mode: "default", date: "0001-01-01", elapsed: { y: 0, m: 0, d: 0 } },
  weekendColor: "",
  showTitleWeekday: true,
  titleFormat: "zh",
  showAltDate: false,
  altDate: { mode: "national", name: "", startDate: "2000-01-01", elapsed: { y: 0, m: 0, d: 0 } },
  openIn: "tab",
  holidayNameWrap: true,
  showSeasonQuarter: false,
  weekdayStyle: "zh",
  disabledModules: [],
  knownModules: [],
  layout: {
    background: ["holiday-bg"],
    tl: ["solar-day"],
    tc: [],
    tr: ["rest-work-badge"],
    bl: [],
    br: [],
    bottom: [],
  },
  // 新安裝：每個項目各自一列；可以在設定的「顯示順序」把某個項目拖到另一個項目後面，讓同一列同時顯示多個
  infoRows: [["lunar-day"], ["festival"], ["solar-term"], ["holiday-name"], ["day-items"], ["note-dot"], ["task-dot"]],
  periodic: {
    daily: { folder: "Daily", subfolder: "", format: "YYYY-MM-DD", template: "" },
    weekly: { folder: "Weekly", subfolder: "", format: "{{weekYear}}-[W]{{week}}", template: "" },
    monthly: { folder: "Monthly", subfolder: "", format: "YYYY-MM", template: "" },
    quarterly: { folder: "Quarterly", subfolder: "", format: "{{quarterYear}}-[Q]{{quarter}}", template: "" },
    yearly: { folder: "Yearly", subfolder: "", format: "YYYY", template: "" },
    taskDiary: { folder: "Daily", subfolder: "", format: "YYYY-MM-DD [Tasks]", template: "" },
  },
  naming: { nameMode: "none", extraEnabled: false, extraFormat: "YYYY-MM-DD HH-mm-ss {{name}}", confirmDblClick: false },
  templates: { templater: true },
  taskTemplates: [],
  taskAdd: { target: "taskDiary", headings: [], tasksStyle: false, locations: [] },
  customItems: { storage: { root: "Tasks List", sub: "none", fileFormat: "[Tasks List]" }, extraPaths: [], templatesFolder: "", sort: "az", color: "", done: {} },
  dayItems: { show: { notes: false, tasks: false, items: true }, max: 0, showDone: false },
  taskDeadline: {
    enabled: true,
    formats: ["📅 YYYY-MM-DD", "YYYY-MM-DD", "YYYY/MM/DD"],
    textFuture: "{n} 天後到期", textToday: "今天到期", textOverdue: "已逾期 {n} 天",
    textStartFuture: "{n} 天後開始", textStartToday: "今天開始",
    textScheduledFuture: "{n} 天後預定", textScheduledToday: "今天預定", textScheduledPast: "預定日已過 {n} 天",
    color: "", overdueColor: "",
  },
  todayColor: "",
  selectedColor: "",
  restWorkBadge: {
    restLabel: "休", workLabel: "班",
    position: "inside", align: "right", custom: "", customSaved: "", priority: "standard",
    bgPriority: ["休", "班"],
    badgeColors: {
      "休": { color: "", opacity: 100, bgColor: "", bgOpacity: 20 },
      "班": { color: "", opacity: 100, bgColor: "", bgOpacity: 20 },
    },
  },
  seasonPreset: "standard",
  seasonCustom: "1-2 春季\n3-9 夏季\n10-12 冬季",
  holiday: { source: "none", country: "JP", custom: {} },
  noteMarks: {
    diary: { mode: "dots", shape: "circle", custom: "", color: "", beside: false, position: "order", maxDots: 5, autoSize: false, paths: [] },
    task: { mode: "dots", shape: "diamond", custom: "", color: "", beside: false, position: "order", maxDots: 5, autoSize: false, paths: [] },
    taskPending: { symbol: "⚠", color: "red" },
  },
  weekStats: { enabled: false, mode: "dots", showTasks: true },
  fonts: { imported: [], global: "theme", systemName: "", blocks: blocks() },
  panelEnabled: true,
  panelRows: 5,
  weekView: { display: "week" },
  heights: { side: { month: 84, week: 150, day: 320 }, main: { month: 84, week: 150, day: 320 } },
  ui: { mode: "month", scope: "day", content: "notes", notesSort: "none", taskSort: "none", taskFilter: "", taskSource: "all", timelineTaskSort: "none", timelineFilter: "all" },
  cache: { holiday: {} },
  gridLines: { enabled: false, color: "", width: 1 },
  extraSources: { enabled: false, paths: [], dateKey: "創建時間", dateFormat: "YYYY-MM-DD" },
};

const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
function deepMerge<T>(base: T, saved: any): T {
  if (saved === undefined) return base;
  if (!isObj(base) || !isObj(saved)) return saved;
  const out: any = { ...(base as any) };
  for (const k of Object.keys(saved)) out[k] = k in (base as any) ? deepMerge((base as any)[k], saved[k]) : saved[k];
  return out;
}

export function mergeSettings(saved: any): CalendarSettings {
  const base: CalendarSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!saved) return base;
  const data = { ...saved };
  // v0.1：daily 欄位 → periodic.daily
  if (data.daily && !data.periodic?.daily) data.periodic = { ...(data.periodic ?? {}), daily: data.daily };
  delete data.daily;
  // v0.3：cache.holidayTw（舊格式）不再使用
  if (data.cache) { data.cache = { ...data.cache }; delete data.cache.holidayTw; }
  // v0.5：節慶來源 id 改過（原本的 "nager" 拆成 jp／us／other），快取裡認不得的來源直接丟棄
  const VALID_HOLIDAY_SRC = new Set(["none", "tw", "jp", "us", "cn", "custom", "other"]);
  if (data.cache?.holiday) {
    for (const key of Object.keys(data.cache.holiday)) if (!VALID_HOLIDAY_SRC.has(key.split(":")[0])) delete data.cache.holiday[key];
  }
  if (data.cache?.holidayMeta) {
    for (const key of Object.keys(data.cache.holidayMeta)) if (!VALID_HOLIDAY_SRC.has(key.split(":")[0])) delete data.cache.holidayMeta[key];
  }
  // v0.4：templates.source / templates.folder 曾是全域設定；v0.5 起模板來源整個拿掉，改成單一路徑欄位，不需遷移
  if (data.templates) data.templates = { templater: data.templates.templater };
  // v0.5：每個週期各自的 templateSource / templateFolder 欄位已移除
  if (data.periodic) for (const k of PERIOD_KINDS) { const cfg = data.periodic[k]; if (cfg) { delete cfg.templateSource; delete cfg.templateFolder; } }
  // v0.5：today-badge／YAML 小圖示整個拿掉；今日數字底色從 today.numberBg 搬到頂層 todayColor
  if (data.today) { if (data.todayColor === undefined && data.today.numberBg) data.todayColor = data.today.numberBg; delete data.today; }
  if (data.yaml) delete data.yaml.icon;
  // v0.6：日記／任務圓點的「達標字數」「未達標時」從共用欄位拆成日記自己的 diaryMinWords/diaryBelowStyle；
  // 任務圓點改成判斷「是否全部勾選完成」，不再有字數門檻，taskBelowStyle 獨立設定
  if (data.noteMarks && (data.noteMarks.minWords !== undefined || data.noteMarks.belowStyle !== undefined)) {
    if (data.noteMarks.diaryMinWords === undefined) data.noteMarks.diaryMinWords = data.noteMarks.minWords ?? 0;
    if (data.noteMarks.diaryBelowStyle === undefined) data.noteMarks.diaryBelowStyle = data.noteMarks.belowStyle ?? "hollow";
    delete data.noteMarks.minWords;
    delete data.noteMarks.belowStyle;
  }
  // v0.5：休／班單一顏色欄位改成依標籤名稱的 badgeColors 對照表
  if (data.restWorkBadge && !data.restWorkBadge.badgeColors) {
    const rw = data.restWorkBadge;
    rw.badgeColors = {
      [rw.restLabel ?? "休"]: { color: rw.restColor ?? "", opacity: 100 },
      [rw.workLabel ?? "班"]: { color: rw.workColor ?? "", opacity: 100 },
    };
    delete rw.restColor; delete rw.workColor;
  }
  // v0.8：休假日底色／補班日底色的單獨欄位併進 badgeColors 的 bgColor／bgOpacity；
  // 自訂徽章新增「保存應用」機制，既有已套用的文字視為已保存；新增 bgPriority 優先序（預設休、班）
  if (data.restWorkBadge) {
    const rw = data.restWorkBadge;
    rw.badgeColors = rw.badgeColors ?? {};
    const restKey = rw.restLabel ?? "休";
    const workKey = rw.workLabel ?? "班";
    if (!rw.badgeColors[restKey]) rw.badgeColors[restKey] = { color: "", opacity: 100 };
    if (!rw.badgeColors[workKey]) rw.badgeColors[workKey] = { color: "", opacity: 100 };
    if (rw.badgeColors[restKey].bgColor === undefined) { rw.badgeColors[restKey].bgColor = rw.restCellBg ?? ""; rw.badgeColors[restKey].bgOpacity = rw.restCellBgOpacity ?? 20; }
    if (rw.badgeColors[workKey].bgColor === undefined) { rw.badgeColors[workKey].bgColor = rw.workCellBg ?? ""; rw.badgeColors[workKey].bgOpacity = rw.workCellBgOpacity ?? 20; }
    for (const def of Object.values(rw.badgeColors) as any[]) {
      if (def.bgColor === undefined) def.bgColor = "";
      if (def.bgOpacity === undefined) def.bgOpacity = 20;
    }
    delete rw.restCellBg; delete rw.restCellBgOpacity; delete rw.workCellBg; delete rw.workCellBgOpacity;
    if (rw.customSaved === undefined) rw.customSaved = rw.custom ?? "";
    if (!rw.bgPriority) rw.bgPriority = [restKey, workKey];
  }
  // v0.7：日記／任務圓點新增「依顯示順序排列」或「固定左下角」。既有使用者升級時維持原本固定左下角
  if (data.noteMarks?.diary && data.noteMarks.diary.position === undefined) data.noteMarks.diary.position = "fixed";
  if (data.noteMarks?.task && data.noteMarks.task.position === undefined) data.noteMarks.task.position = "fixed";
  // v0.10：日記圓點的「達標字數／未達標時」移除；任務圓點的「未達標時」改成自訂義的未完成樣式
  if (data.noteMarks) { delete data.noteMarks.diaryMinWords; delete data.noteMarks.diaryBelowStyle; delete data.noteMarks.taskBelowStyle; }
  if (data.weekStats) delete data.weekStats.useMinWords;
  // v0.10：日期下方的 sub／sub2／sub3 三個插槽合併成「資訊列」infoRows；舊設定每個插槽變成一列，畫面維持原樣
  if (data.layout && (data.layout.sub || data.layout.sub2 || data.layout.sub3) && !data.infoRows) {
    data.infoRows = [data.layout.sub, data.layout.sub2, data.layout.sub3].filter((r: any) => Array.isArray(r) && r.length);
  }
  if (data.layout) { delete data.layout.sub; delete data.layout.sub2; delete data.layout.sub3; }
  // v0.10：「顯示農曆年月日」改名「顯示另一份年月日」；節慶文字排列選項刪除（改由顯示順序決定）
  if (data.showLunarHeader !== undefined) { if (data.showAltDate === undefined) data.showAltDate = data.showLunarHeader; delete data.showLunarHeader; }
  if (data.yaml) delete data.yaml.festivalPlacement;
  // v0.10：新增任務可以設多個標題
  if (data.taskAdd && data.taskAdd.heading !== undefined) {
    if (data.taskAdd.headings === undefined) data.taskAdd.headings = data.taskAdd.heading ? [data.taskAdd.heading] : [];
    delete data.taskAdd.heading;
  }
  // v0.15：格子高度改成「側邊欄／新分頁 × 月曆／週曆／日曆」六個各自獨立；舊的三個全域高度各自複製到兩個位置
  if (data.cellHeight !== undefined || data.weekCellHeight !== undefined || data.dayCellHeight !== undefined) {
    const h = { month: data.cellHeight ?? 84, week: data.weekCellHeight ?? 150, day: data.dayCellHeight ?? 320 };
    data.heights = data.heights ?? { side: { ...h }, main: { ...h } };
    delete data.cellHeight; delete data.weekCellHeight; delete data.dayCellHeight;
  }
  // v0.14：移除 YAML 自訂文字；自訂文字／自訂事項/任務（文字規則寫法）全部改成用表單建立的「自訂事項／任務」，舊資料不再讀取
  delete data.yaml; delete data.customText; delete data.customTasks;
  const dead = new Set(["yaml-text", "custom-text"]);
  if (Array.isArray(data.infoRows)) data.infoRows = data.infoRows.map((r: string[]) => r.filter((x) => !dead.has(x))).filter((r: string[]) => r.length);
  if (data.layout) for (const k of Object.keys(data.layout)) if (Array.isArray(data.layout[k])) data.layout[k] = data.layout[k].filter((x: string) => !dead.has(x));
  for (const key of ["disabledModules", "knownModules"]) if (Array.isArray(data[key])) data[key] = data[key].filter((x: string) => !dead.has(x));
  // v0.13：到期文字的預設值從「剩下 {n} 天」改成跟 Tasks 外掛一致的「{n} 天後到期」（使用者自己改過的不動）
  if (data.taskDeadline?.textFuture === "剩下 {n} 天") data.taskDeadline.textFuture = "{n} 天後到期";
  // v0.13：事項/任務日記的模板改成「可多個檔案或資料夾」統一放在 taskTemplates；舊的單一模板欄位併進去
  if (data.periodic?.taskDiary?.template) {
    data.taskTemplates = Array.isArray(data.taskTemplates) ? data.taskTemplates : [];
    if (!data.taskTemplates.includes(data.periodic.taskDiary.template)) data.taskTemplates.unshift(data.periodic.taskDiary.template);
    data.periodic.taskDiary.template = "";
  }
  const merged = deepMerge(base, data);
  for (const k of PERIOD_KINDS) merged.periodic[k] = { ...base.periodic[k], ...merged.periodic[k] };
  reconcileDotPosition(merged);
  return merged;
}

/** 把某個模塊從所有資訊列拿掉（拿掉後變成空列的整列刪除） */
export function removeFromInfoRows(rows: string[][], id: string): string[][] {
  return rows.map((r) => r.filter((x) => x !== id)).filter((r) => r.length > 0);
}

/** 確保 note-dot／task-dot 實際所在位置跟它們各自的 position 設定一致（order → 資訊列；fixed → 左下角 bl） */
export function reconcileDotPosition(s: CalendarSettings) {
  for (const id of ["note-dot", "task-dot"] as const) {
    const cfg = id === "note-dot" ? s.noteMarks.diary : s.noteMarks.task;
    if (cfg.position === "fixed") {
      s.infoRows = removeFromInfoRows(s.infoRows, id);
      for (const slot of Object.keys(s.layout) as FixedSlot[]) if (slot !== "bl") s.layout[slot] = s.layout[slot].filter((x) => x !== id);
      if (!s.layout.bl.includes(id)) s.layout.bl = [...s.layout.bl, id];
    } else {
      for (const slot of Object.keys(s.layout) as FixedSlot[]) s.layout[slot] = s.layout[slot].filter((x) => x !== id);
      if (!s.infoRows.some((r) => r.includes(id))) s.infoRows = [...s.infoRows, [id]];
    }
  }
}

/** 確保某個模塊至少排進一個位置（新版新增的模塊，對舊設定檔來說沒有位置）：info 模塊新增一列，其餘放進預設插槽 */
export function ensureModulePlaced(s: CalendarSettings, id: string, slot: string) {
  if (s.infoRows.some((r) => r.includes(id))) return;
  for (const k of Object.keys(s.layout) as FixedSlot[]) if (s.layout[k].includes(id)) return;
  if (slot === "info") s.infoRows = [...s.infoRows, [id]];
  else if (slot in s.layout) s.layout[slot as FixedSlot] = [...s.layout[slot as FixedSlot], id];
}

/**
 * 顯示順序：把某個模塊移到另一個模塊「後面」（同一列由左到右多顯示一個）；
 * 或 newRow：獨立成一列，插在第 index 列之前（index 是移動前的列號，等於列數就是放到最後）。
 * 移走後變成空列的整列會自動刪除。回傳新的列陣列（不改動傳入的陣列）。
 */
export type InfoDrop = { kind: "after"; targetId: string } | { kind: "newRow"; index: number };
export function moveInfoItem(rows: string[][], id: string, drop: InfoDrop): string[][] {
  if (drop.kind === "after" && drop.targetId === id) return rows;
  const from = rows.findIndex((r) => r.includes(id));
  const next = rows.map((r) => [...r]);
  if (from >= 0) next[from] = next[from].filter((x) => x !== id);
  const dropped = from >= 0 && next[from].length === 0;
  if (drop.kind === "after") {
    const row = next.find((r) => r.includes(drop.targetId));
    if (!row) return rows;
    row.splice(row.indexOf(drop.targetId) + 1, 0, id);
    return next.filter((r) => r.length > 0);
  }
  const kept = next.filter((r) => r.length > 0);
  const idx = Math.max(0, Math.min(kept.length, drop.index - (dropped && from < drop.index ? 1 : 0)));
  kept.splice(idx, 0, [id]);
  return kept;
}

/** 顯示順序：整列上下移動（把第 from 列移到第 to 列的位置） */
export function moveInfoRow(rows: string[][], from: number, to: number): string[][] {
  if (from === to || from < 0 || from >= rows.length) return rows;
  const next = rows.map((r) => [...r]);
  const [row] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, row);
  return next;
}
