import { App, Notice, PluginSettingTab, Setting, TFile, moment } from "obsidian";
import type ModularCalendarPlugin from "./main";
import { STANDARD_CELL_IDS } from "./main";
import { BLOCKS, DotShape, MarkCfg, SEASON_PRESETS, Elapsed, ensureModulePlaced, moveInfoItem, moveInfoRow, reconcileDotPosition, removeFromInfoRows } from "./core/settings";
import { FIXED_SLOTS, PERIOD_KINDS, PERIOD_LABEL, PeriodKind } from "./core/types";
import { getSeasons } from "./util/calendar";
import { relPath, resolveTemplate, templateFiles } from "./notes/periodic";
import { formatProblem } from "./notes/keys";
import { FileSuggest, FolderSuggest } from "./util/suggest";
import { HOLIDAY_SOURCE_LABEL, NAGER_COUNTRIES, normalizeHolidayJson } from "./providers/holiday-data";
import { COLOR_HINT, resolveColor, toBackground } from "./util/color";
import { parseCustomBadges, parseCustomBadgesDetailed } from "./util/badges";
import { FolderPickerModal } from "./util/template-picker";
import { debugExtraSources } from "./notes/extra-sources";
import { addElapsed, effectiveCountry, nationalYear } from "./util/altdate";
import { RULE_HELP, compileRule, parseRuleLine } from "./util/rules";
import { filesUnder } from "./notes/custom-entries";
import { storagePath } from "./notes/custom-items";
import { deleteTemplate, exportTemplates, importTemplates, listTemplates, templatePath } from "./notes/item-templates";
import { validateGlyph } from "./util/marks";
import { FORMAT_EXAMPLES, TOKEN_DOCS, VAR_DOCS, renderFormat } from "./util/format";

const HOLIDAY_JSON_EXAMPLE = `[
  { "date": "2026-10-10", "name": "國慶日", "isRest": true },
  { "date": "2026-01-18", "name": "補班", "isRest": false, "isMakeupWork": true }
]

// 或者最簡單的「日期：名稱」對照表：
{
  "2026-01-01": "元旦",
  "2026-10-10": "國慶日"
}`;

/** 設定頁的分類（頁面最上面那一排按鈕）：標題以 heads 任一個開頭的區塊歸到這一類 */
export const SETTING_TABS: { id: string; label: string; heads: string[] }[] = [
  { id: "general", label: "一般", heads: ["一般", "字體"] },
  { id: "notes", label: "日記·筆記", heads: ["週期筆記", "日記命名", "額外來源"] },
  { id: "holiday", label: "節慶·季節", heads: ["節慶", "季節"] },
  { id: "cell", label: "格內顯示", heads: ["格內模塊", "顯示順序", "操作模塊", "週統計"] },
  { id: "list", label: "清單·週曆", heads: ["下方清單", "週曆"] },
  { id: "tasks", label: "任務", heads: ["任務"] },
  { id: "items", label: "自訂事項/任務", heads: ["自訂事項/任務"] },
];
export const tabOf = (heading: string) => SETTING_TABS.find((t) => t.heads.some((h) => heading.startsWith(h)))?.id ?? "general";

export class CalendarSettingTab extends PluginSettingTab {
  private searchBox: HTMLInputElement | null = null;

  constructor(app: App, private plugin: ModularCalendarPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const apply = () => this.plugin.saveAndRefresh();
    // 很多設定切換後都會呼叫 this.display() 整頁重繪；不先記住捲動位置的話，每調一個選項畫面就跳回最上面。
    // 不確定真正會捲動的是 containerEl 本身還是它的父層，兩個都記、都還原，其中一個通常會是沒作用的空操作。
    const scrollTargets = [containerEl, containerEl.parentElement].filter((e): e is HTMLElement => !!e);
    const scrollPositions = scrollTargets.map((e) => e.scrollTop);
    containerEl.empty();

    // ───────── 搜尋 ─────────
    const searchWrap = containerEl.createDiv({ cls: "dcal-settings-search" });
    const search = searchWrap.createEl("input", { type: "text", placeholder: "搜尋設定項目…（例如「農曆」「圓點」「模板」）" });
    this.searchBox = search;
    search.oninput = () => this.applySearch(search.value);

    // ───────── 一般 ─────────
    containerEl.createEl("h3", { text: "一般" });
    new Setting(containerEl).setName("每週起始日")
      .setDesc("週一起算採 ISO 週數；其他起始日以含 1/1 的那週為第 1 週")
      .addDropdown((d) =>
        d.addOptions({ "0": "週日", "1": "週一", "6": "週六" })
          .setValue(String(s.weekStart))
          .onChange(async (v) => { s.weekStart = Number(v); await apply(); })
      );
    new Setting(containerEl).setName("顯示星期幾")
      .setDesc("標題日期旁顯示星期幾，例如「9月28日 週一」")
      .addToggle((t) => t.setValue(s.showTitleWeekday).onChange(async (v) => { s.showTitleWeekday = v; await apply(); }));
    new Setting(containerEl).setName("顯示另一份年月日").setDesc("標題第二列再多顯示一份年月日，預設關閉")
      .addToggle((t) => t.setValue(s.showAltDate).onChange(async (v) => { s.showAltDate = v; await apply(); this.display(); }));
    if (s.showAltDate) {
      new Setting(containerEl).setName("顯示方式")
        .setDesc("國家＝上面「節慶／假日」選的資料來源對應的國家")
        .addDropdown((d) =>
          d.addOptions({ national: "國家的年曆（預設）", lunar: "國家的農曆年月日", custom: "自訂義" }).setValue(s.altDate.mode)
            .onChange(async (v) => { s.altDate.mode = v as any; await apply(); this.display(); })
        );
      if (s.altDate.mode === "national") {
        const y = nationalYear(effectiveCountry(s), moment());
        containerEl.createEl("p", { cls: "setting-item-description", text: y
          ? `目前會顯示例如「${y}${moment().month() + 1}月${moment().date()}日」。有自己紀年的國家：日本（令和）、台灣（中華民國）、泰國（佛曆）。`
          : "目前選的節慶／假日來源沒有自己的紀年（或還沒選國家），所以這一份不會顯示。有自己紀年的國家：日本（令和）、台灣（中華民國）、泰國（佛曆）。" });
      }
      if (s.altDate.mode === "custom") {
        this.renderElapsedEditor(containerEl, {
          withName: true, name: s.altDate.name, startDate: s.altDate.startDate, elapsed: s.altDate.elapsed,
          desc: "每一天顯示成：名稱＋從起始日期起算經過的年月日（再加上下面填的「已經過」）。名稱可以留空。例如起始 2020-05-01、已經過 0／0／0，到 2026-09-30 就會顯示 6年4月29日",
          onSave: async (d) => { s.altDate.name = d.name; s.altDate.startDate = d.startDate; s.altDate.elapsed = d.elapsed; await apply(); },
        });
      }
    }
    new Setting(containerEl).setName("顯示季節／第幾季度").setDesc("預設關閉")
      .addToggle((t) => t.setValue(s.showSeasonQuarter).onChange(async (v) => { s.showSeasonQuarter = v; await apply(); }));
    new Setting(containerEl).setName("標題日期格式")
      .setDesc("中文：2026年9月28日；國際：28 Sep 2026")
      .addDropdown((d) =>
        d.addOptions({ zh: "中文（2026年9月28日）", intl: "國際（28 Sep 2026）" }).setValue(s.titleFormat)
          .onChange(async (v) => { s.titleFormat = v as any; await apply(); })
      );
    new Setting(containerEl).setName("星期表頭風格")
      .setDesc("選了節慶／假日來源的「日本」時，這裡會自動改用日文（月火水木金土日），不受這個設定影響")
      .addDropdown((d) =>
        d.addOptions({ zh: "中文（日一二三四五六）", en3: "英文三字（Mon Tue…）", en2: "英文兩字（Mo Tu…）", en1: "英文一字（M T…）", ja: "日文（月火水木金土日）" })
          .setValue(s.weekdayStyle).onChange(async (v) => { s.weekdayStyle = v as any; await apply(); })
      );

    // ───────── 起始年月日 ─────────
    new Setting(containerEl).setName("起始年月日")
      .setDesc("限制月曆最早可以瀏覽到哪一天（例如某個紀年的起點）；預設不特別限制")
      .addDropdown((d) =>
        d.addOptions({ default: "默認（不限制）", custom: "自訂義" }).setValue(s.startDate.mode)
          .onChange(async (v) => { s.startDate.mode = v as any; await apply(); this.display(); })
      );
    if (s.startDate.mode === "custom") {
      this.renderElapsedEditor(containerEl, {
        withName: false, name: "", startDate: s.startDate.date, elapsed: s.startDate.elapsed,
        desc: "起始日期＝最早可以瀏覽到的日期。「已經過」填了的話，按保存應用後月曆會跳到「起始日期＋已經過的年月日」那一天，之後每一天都由這天往後推算；都填 0 就是直接跳到起始日期",
        onSave: async (d) => {
          s.startDate.date = d.startDate; s.startDate.elapsed = d.elapsed;
          await this.plugin.saveSettings();
          await this.plugin.jumpViewsTo(addElapsed(moment(d.startDate, "YYYY-MM-DD"), d.elapsed));
        },
      });
    }

    // ───────── 網格線 ─────────
    containerEl.createEl("h4", { text: "格線" });
    new Setting(containerEl).setName("啟用").setDesc("日期格與週數欄之間的網格線，預設關閉")
      .addToggle((t) => t.setValue(s.gridLines.enabled).onChange(async (v) => { s.gridLines.enabled = v; await apply(); this.display(); }));
    if (s.gridLines.enabled) {
      this.colorSetting(containerEl, "格線顏色", "", s.gridLines.color, async (v) => { s.gridLines.color = v; await apply(); });
      new Setting(containerEl).setName("格線寬度（px）").addText((t) =>
        t.setValue(String(s.gridLines.width)).onChange(async (v) => { const n = Number(v); if (n >= 0) { s.gridLines.width = n; await apply(); } })
      );
    }

    // ───────── 今日、選取日、週末顏色（放在一起） ─────────
    containerEl.createEl("h4", { text: "今日、選取日、週末顏色" });
    this.colorSetting(containerEl, "今日數字底色", "只影響「今天」那一格的公曆數字底色", s.todayColor, async (v) => { s.todayColor = v; await apply(); });
    this.colorSetting(containerEl, "選取日框顏色", "點擊某一天後，那一格的外框顏色", s.selectedColor, async (v) => { s.selectedColor = v; await apply(); });
    this.colorSetting(containerEl, "週六／週日數字顏色", "星期表頭跟日期格裡的週六、週日公曆數字", s.weekendColor, async (v) => { s.weekendColor = v; await apply(); });

    // ───────── 檔名與資料夾格式 ─────────
    containerEl.createEl("h3", { text: "週期筆記：資料夾、檔名與模板" });
    this.renderFormatHelp(containerEl);
    new Setting(containerEl).setName("支援 Templater")
      .setDesc("對所有使用模板建立的週期筆記都適用：建立後若模板含有 <% %> 語法，交給 Templater 外掛處理（需另外安裝 Templater）")
      .addToggle((t) => t.setValue(s.templates.templater).onChange(async (v) => { s.templates.templater = v; await apply(); }));

    for (const k of PERIOD_KINDS) {
      const cfg = s.periodic[k];
      containerEl.createEl("h4", { text: PERIOD_LABEL[k] });

      new Setting(containerEl).setName("根資料夾").setDesc("點一下可從現有資料夾挑選，也可以自行輸入").addText((t) => {
        new FolderSuggest(this.app, t.inputEl);
        t.setValue(cfg.folder).onChange(async (v) => { cfg.folder = v.trim(); await apply(); this.refreshFormatPreview(k); });
      });

      new Setting(containerEl).setName("依年／月建立子資料夾")
        .setDesc("例如 YYYY 會建立「根資料夾/2026/」；YYYY/MM 會再建月份子資料夾；留空則直接放在根資料夾")
        .addText((t) => t.setValue(cfg.subfolder).onChange(async (v) => { cfg.subfolder = v.trim(); await apply(); this.refreshFormatPreview(k); }));

      const fmtSetting = new Setting(containerEl).setName("檔名格式");
      fmtSetting.addText((t) =>
        t.setValue(cfg.format).onChange(async (v) => { cfg.format = v.trim() || cfg.format; await apply(); this.refreshFormatPreview(k); })
      );
      const preview = fmtSetting.descEl.createDiv({ cls: `dcal-fmt-preview dcal-fmt-preview-${k}` });
      this.paintFormatPreview(preview, k, cfg.format);

      if (k === "taskDiary") this.renderTaskTemplateList(containerEl, apply);
      else this.renderTemplatePathField(containerEl, `模板路徑`,
        "支援 {{date}}、{{date:格式}}、{{title}}" + (k === "daily" ? "、{{lunar}}、{{solarTerm}}、{{holiday}}" : ""),
        cfg.template, async (v) => { cfg.template = v; await apply(); });
    }

    // ───────── 日記命名 ─────────
    containerEl.createEl("h3", { text: "日記命名" });
    {
      const det = containerEl.createEl("details", { cls: "dcal-help" });
      det.createEl("summary", { text: "日記圓點怎麼判斷「同一天有好幾篇」？（點開說明）" });
      det.createEl("p", { text: "只要檔名符合日記的檔名格式（或下面的「新日記的命名規則」），就會被算進同一天，即使檔名後面多了編號或文字也一樣。以檔名格式 YYYY-MM-DD 為例：" });
      for (const [ex, note] of [
        ["2026-01-01.md", "完全符合格式，算 1 篇"],
        ["2026-01-01 1.md", "日期後面多了空白＋編號，仍算同一天的另一篇"],
        ["2026-01-01 早上.md", "日期後面多了空白＋任意文字，仍算同一天的另一篇"],
        ["20260101.md", "跟格式 YYYY-MM-DD 對不起來（少了 -），不會被算進去"],
      ] as const) det.createEl("p", { text: `${ex}：${note}` });
      det.createEl("p", { text: "如果想要固定的命名規則（例如統一加上時分秒），可以開啟下面「創建新日記」並設定命名規則，建立時就會照那個規則產生檔名。" });
    }
    new Setting(containerEl).setName("檔名格式裡的 {{name}}")
      .setDesc("建立日記時，{{name}} 要填入什麼")
      .addDropdown((d) =>
        d.addOptions({ none: "不使用（忽略 {{name}}）", template: "取模板檔名", prompt: "建立時彈出輸入框" })
          .setValue(s.naming.nameMode).onChange(async (v) => { s.naming.nameMode = v as any; await apply(); })
      );
    new Setting(containerEl).setName("雙擊建立前彈出確認")
      .setDesc("關閉時雙擊空白格會直接建立日記")
      .addToggle((t) => t.setValue(s.naming.confirmDblClick).onChange(async (v) => { s.naming.confirmDblClick = v; await apply(); }));
    new Setting(containerEl).setName("右鍵選單提供「創建新日記」")
      .setDesc("即使當天已有日記，也能再建立一篇新的（例如一天寫多篇）。開啟後請設定下面的命名規則")
      .addToggle((t) => t.setValue(s.naming.extraEnabled).onChange(async (v) => { s.naming.extraEnabled = v; await apply(); this.display(); }));
    if (s.naming.extraEnabled) {
      const extra = new Setting(containerEl).setName("新日記的命名規則")
        .setDesc("需含時／分／秒等可區分同一天多篇的欄位，例如 HH-mm-ss，否則會自動加上 (2) 等編號");
      extra.addText((t) => t.setValue(s.naming.extraFormat).onChange(async (v) => { s.naming.extraFormat = v.trim() || s.naming.extraFormat; await apply(); this.refreshFormatPreview("daily", true); }));
      const preview = extra.descEl.createDiv({ cls: "dcal-fmt-preview dcal-fmt-preview-daily-extra" });
      this.paintFormatPreview(preview, "daily", s.naming.extraFormat, true);
    }

    // ───────── 節慶／假日 ─────────
    containerEl.createEl("h3", { text: "節慶／假日" });
    new Setting(containerEl).setName("資料來源").addDropdown((d) =>
      d.addOptions(HOLIDAY_SOURCE_LABEL)
        .setValue(s.holiday.source).onChange(async (v) => { s.holiday.source = v as any; await apply(); this.display(); })
    );
    if (s.holiday.source === "other") {
      new Setting(containerEl).setName("國家／地區").addDropdown((d) => {
        const o: Record<string, string> = {};
        for (const [code, label] of NAGER_COUNTRIES) o[code] = `${label}（${code}）`;
        d.addOptions(o).setValue(s.holiday.country).onChange(async (v) => { s.holiday.country = v; await apply(); });
      });
    }
    if (s.holiday.source === "jp") {
      containerEl.createEl("p", { cls: "setting-item-description", text: "選日本時會自動在地化：星期表頭改用日文（月火水木金土日）、標題的農曆年月日改用日本年號（例如令和8年），「農曆節氣」模塊也會改顯示日本傳統的六曜吉凶（先勝／友引／先負／仏滅／大安／赤口）。" });
    }
    if (s.holiday.source === "custom") {
      containerEl.createEl("p", { cls: "setting-item-description", text: "此模式不會連網下載，只使用下面「導入自訂節慶 JSON」的資料。" });
    }
    new Setting(containerEl).setName("清除已下載的快取").setDesc("換來源後如果沒更新，可以清一次快取重新下載")
      .addButton((b) => b.setButtonText("清除並重新整理").onClick(async () => { s.cache.holiday = {}; s.cache.holidayMeta = {}; await apply(); this.display(); }));

    this.renderCacheList(containerEl);
    this.renderHolidayImportExport(containerEl, apply);

    // ───────── 季節與季度 ─────────
    containerEl.createEl("h3", { text: "季節與季度" });
    new Setting(containerEl).setName("季節預設").addDropdown((d) => {
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(SEASON_PRESETS)) o[k] = v.label;
      o.custom = "自訂";
      d.addOptions(o).setValue(s.seasonPreset).onChange(async (v) => { s.seasonPreset = v; await apply(); this.display(); });
    });
    if (s.seasonPreset === "custom") {
      new Setting(containerEl)
        .setName("自訂季節")
        .setDesc("每行一個：起月-迄月 名稱。例：3-9 夏季；可跨年：12-2 冬季。沒被涵蓋的月份不顯示季節。有些地區四季不明顯，也可以只定義一兩個季節。")
        .addTextArea((t) => { t.inputEl.rows = 5; t.setValue(s.seasonCustom).onChange(async (v) => { s.seasonCustom = v; await apply(); }); });
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "目前解析結果：" + (getSeasons(s).map((d) => `${d.start}–${d.end}月 ${d.name}`).join("、") || "（無）"),
      });
    }
    new Setting(containerEl).setName("季度起始月")
      .setDesc("1 = 一般日曆季度（Q1 = 1–3 月）；填 4 則以 4 月為 Q1 起點（財年）")
      .addDropdown((d) => {
        const o: Record<string, string> = {};
        for (let i = 1; i <= 12; i++) o[String(i)] = `${i} 月`;
        d.addOptions(o).setValue(String(s.quarterStartMonth)).onChange(async (v) => { s.quarterStartMonth = Number(v); await apply(); });
      });

    // ───────── 字體 ─────────
    containerEl.createEl("h3", { text: "字體" });
    new Setting(containerEl).setName("全域字體").addDropdown((d) =>
      d.addOptions({ theme: "跟隨 Obsidian 主題", sys: "系統字型", ...Object.fromEntries(s.fonts.imported.map((f) => [`imp:${f.id}`, f.name])) })
        .setValue(s.fonts.global).onChange(async (v) => { s.fonts.global = v; await apply(); })
    );
    if (s.fonts.global === "sys") {
      new Setting(containerEl).setName("系統字型名稱").addText((t) =>
        t.setPlaceholder("例如 Microsoft JhengHei").setValue(s.fonts.systemName).onChange(async (v) => { s.fonts.systemName = v; await apply(); })
      );
    }
    new Setting(containerEl).setName("導入字體檔")
      .setDesc("先把字體檔（.ttf/.otf/.woff2）放進 vault，再輸入名稱與路徑")
      .addText((t) => t.setPlaceholder("字體名稱"))
      .addText((t) => { new FileAnySuggest(this.app, t.inputEl); t.setPlaceholder("字體檔路徑，如 Fonts/Custom.ttf"); })
      .addButton((b) => {
        b.setButtonText("加入").onClick(async (ev: MouseEvent) => {
          const row = (ev.target as HTMLElement).closest(".setting-item") as HTMLElement;
          const inputs = row.querySelectorAll("input");
          const name = (inputs[0] as HTMLInputElement)?.value.trim();
          const file = (inputs[1] as HTMLInputElement)?.value.trim();
          if (!name || !file) { new Notice("請填寫名稱與路徑"); return; }
          if (!this.app.vault.getAbstractFileByPath(file)) { new Notice("找不到這個檔案"); return; }
          s.fonts.imported.push({ id: `f${Date.now()}`, name, file });
          await apply();
          this.display();
        });
      });
    for (const f of s.fonts.imported) {
      new Setting(containerEl).setName(f.name).setDesc(f.file).addButton((b) =>
        b.setButtonText("移除").onClick(async () => {
          s.fonts.imported = s.fonts.imported.filter((x) => x.id !== f.id);
          for (const blk of BLOCKS) if (s.fonts.blocks[blk.id].family === `imp:${f.id}`) s.fonts.blocks[blk.id].family = "global";
          if (s.fonts.global === `imp:${f.id}`) s.fonts.global = "theme";
          await apply();
          this.display();
        })
      );
    }

    containerEl.createEl("h4", { text: "各區塊字體大小" });
    new Setting(containerEl).setName("全部區塊").addDropdown((d) =>
      d.addOptions({ "": "（個別設定，見下）", default: "全部設為預設大小", compact: "全部設為緊湊" })
        .setValue("").onChange(async (v) => {
          if (!v) return;
          for (const b of BLOCKS) s.fonts.blocks[b.id].size = v as any;
          await apply();
          this.display();
        })
    );
    for (const b of BLOCKS) {
      const cfg = s.fonts.blocks[b.id];
      const row = new Setting(containerEl).setName(b.label);
      row.addDropdown((d) =>
        d.addOptions({ global: "跟隨全域", theme: "跟隨 Obsidian", sys: "系統字型", ...Object.fromEntries(s.fonts.imported.map((f) => [`imp:${f.id}`, f.name])) })
          .setValue(cfg.family).onChange(async (v) => { cfg.family = v; await apply(); })
      );
      row.addDropdown((d) =>
        d.addOptions({ default: "預設大小", compact: "緊湊", custom: "自訂" }).setValue(cfg.size)
          .onChange(async (v) => { cfg.size = v as any; await apply(); this.display(); })
      );
      if (cfg.size === "custom") {
        row.addText((t) => t.setValue(String(cfg.px)).onChange(async (v) => { const n = Number(v); if (n > 0) { cfg.px = n; await apply(); } }));
      }
    }

    // ───────── 下方清單 ─────────
    containerEl.createEl("h3", { text: "下方清單（當日／本週／本月）" });
    new Setting(containerEl).setName("啟用").addToggle((t) => t.setValue(s.panelEnabled).onChange(async (v) => { s.panelEnabled = v; await apply(); }));
    new Setting(containerEl).setName("一次顯示列數").setDesc("超過用滾輪捲動。選「自動」會依視窗剩餘的高度（底下欄框）調整，不固定列數。月曆高度也可直接拖曳月曆與清單之間的橫線調整（雙擊還原）")
      .addDropdown((d) => {
        const o: Record<string, string> = { "0": "自動（根據底下欄框調整）" };
        for (let i = 3; i <= 10; i++) o[String(i)] = `${i} 列`;
        d.addOptions(o).setValue(String(s.panelRows)).onChange(async (v) => { s.panelRows = Number(v); await apply(); });
      });

    // ───────── 週曆 ─────────
    containerEl.createEl("h3", { text: "週曆" });
    new Setting(containerEl).setName("週曆顯示方式")
      .setDesc("週數顯示：顯示選取日所在的那一週（含週數）；今日顯示：最左邊是今天，往後共七天（‹ › 以七天為單位移動）。切換到「週曆」請用月曆上方最左邊的按鈕")
      .addDropdown((d) =>
        d.addOptions({ week: "週數顯示（預設）", today: "今日顯示（今天起七天）" }).setValue(s.weekView.display)
          .onChange(async (v) => { s.weekView.display = v as any; await apply(); })
      );

    // ───────── 週統計 ─────────
    containerEl.createEl("h3", { text: "週統計（週數欄下方）" });
    new Setting(containerEl).setName("啟用").addToggle((t) => t.setValue(s.weekStats.enabled).onChange(async (v) => { s.weekStats.enabled = v; await apply(); }));
    if (s.weekStats.enabled) {
      new Setting(containerEl).setName("顯示方式").addDropdown((d) =>
        d.addOptions({ dots: "圓點", number: "數字" }).setValue(s.weekStats.mode).onChange(async (v) => { s.weekStats.mode = v as any; await apply(); })
      );
      new Setting(containerEl).setName("也統計任務清單").addToggle((t) => t.setValue(s.weekStats.showTasks).onChange(async (v) => { s.weekStats.showTasks = v; await apply(); }));
    }

    // ───────── 任務 ─────────
    containerEl.createEl("h3", { text: "任務" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "「事項/任務日記」是專門放任務的一篇筆記（資料夾、檔名格式在上面「週期筆記」的「事項/任務日記」那一組設定，檔名格式要跟日記不同，否則會被認成同一份）。月曆右鍵可以建立／開啟事項/任務日記，下方清單與時間軸新增的任務預設也會加到那裡。" });
    new Setting(containerEl).setName("新增任務預設加到")
      .addDropdown((d) =>
        d.addOptions({ taskDiary: "當天的事項/任務日記", daily: "當天的一般日記" }).setValue(s.taskAdd.target)
          .onChange(async (v) => { s.taskAdd.target = v as any; await apply(); })
      );
    new Setting(containerEl).setName("可以加到哪些標題底下")
      .setDesc("每行一個標題，例如「## 待辦事項」「# 任務」（要寫出完整的標題行），可以設多個，第一個是預設。新增任務時如果設了多個，會讓你選要加到哪一個；任務會接在該標題底下現有任務的最後一條後面、依序往下加，筆記裡找不到這個標題就會自動建立。留空＝直接加在筆記最後")
      .addTextArea((t) => { t.inputEl.rows = 3; t.setPlaceholder("## 待辦事項\n## 想做的事").setValue(s.taskAdd.headings.join("\n")).onChange(async (v) => { s.taskAdd.headings = v.split("\n").map((x) => x.trim()).filter(Boolean); await apply(); }); });
    {
      const locRow = new Setting(containerEl).setName("任務存放位置（可多個）")
        .setDesc("每行一個 md 檔案或資料夾。月曆右鍵「新增任務（Tasks 樣式）」前，除了當日的事項/任務日記，也可以從這裡挑選；選資料夾時，會用「日期＋事項/任務日記檔名格式」在那個資料夾裡建立／使用當天那一篇");
      const st = locRow.descEl.createDiv({ cls: "dcal-extra-debug" });
      const showLoc = () => {
        st.empty();
        for (const p of s.taskAdd.locations) {
          const n = filesUnder(this.app, [p]).length;
          st.createDiv({ cls: n ? "dcal-hint" : "dcal-hint is-warn", text: n ? `✓ ${p}（找到 ${n} 個 md 檔案）` : `${p}（目前還沒有，選到時會自動建立）` });
        }
      };
      locRow.addTextArea((t) => { t.inputEl.rows = 3; t.setValue(s.taskAdd.locations.join("\n")).onChange(async (v) => { s.taskAdd.locations = v.split("\n").map((x) => x.trim()).filter(Boolean); showLoc(); await apply(); }); });
      showLoc();
    }
    const tasksInstalled = this.plugin.hasTasksPlugin();
    new Setting(containerEl).setName("用 Tasks 外掛的樣式新增任務")
      .setDesc(tasksInstalled
        ? "下方清單、時間軸快速新增任務時，附上 Tasks 外掛的 📅 到期日（當天）。勾選任務時，若該行已有 Tasks 的日期符號，也會同步補上／移除 ✅ 完成日期。月曆右鍵的「新增任務（Tasks 樣式）」則是直接叫出 Tasks 的「Create or edit task」面板，跟這個開關無關"
        : "沒有偵測到 Tasks 外掛，這個選項暫時無效（月曆右鍵的「新增任務（Tasks 樣式）」也會顯示需要安裝 Tasks 外掛）")
      .addToggle((t) => t.setValue(s.taskAdd.tasksStyle).onChange(async (v) => { s.taskAdd.tasksStyle = v; await apply(); }));
    containerEl.createEl("p", { cls: "setting-item-description", text: "事項/任務日記的模板（可以多個檔案或資料夾）請到上方「週期筆記」的「事項/任務日記」那一組設定。" });

    // ───────── 任務的剩餘天數 ─────────
    containerEl.createEl("h4", { text: "任務的時間狀態" });
    const dl = s.taskDeadline;
    new Setting(containerEl).setName("在任務旁顯示時間狀態")
      .setDesc("任務文字裡有日期時，在月曆下方的任務清單、時間軸裡，任務的右邊顯示離今天還有幾天；任務勾選後就不再顯示")
      .addToggle((t) => t.setValue(dl.enabled).onChange(async (v) => { dl.enabled = v; await apply(); this.display(); }));
    if (dl.enabled) {
      new Setting(containerEl).setName("要辨識的日期寫法")
        .setDesc("每行一種，可以設多個，由上往下找到第一個符合的。例如 YYYY-MM-DD、截止 YYYY/MM/DD、[due] YYYY-MM-DD。要原樣比對的英文字請用 [] 包起來（YYYY=年 MM=月 DD=日；沒有 [] 的英文字母會被當成日期符號）。預設第一行 📅 是 Tasks 外掛的到期日，避免被「建立日期」誤判")
        .addTextArea((t) => { t.inputEl.rows = 3; t.setValue(dl.formats.join("\n")).onChange(async (v) => { dl.formats = v.split("\n").map((x) => x.trim()).filter(Boolean); await apply(); }); });
      containerEl.createEl("p", { cls: "setting-item-description", text: "依 Tasks 外掛的日期邏輯：🛫 開始日還沒到顯示「N 天後開始」；📅 到期日顯示「N 天後到期」「今天到期」「已逾期 N 天」；只有 ⏳ 預定日（沒有到期日）時顯示「N 天後預定」等。文字裡完全沒有 Tasks 日期符號時，才用上面的自訂日期寫法，找到的日期當作到期日。{n} 會換成天數。" });
      const txt = (name: string, key: keyof typeof dl, fallback: string) =>
        new Setting(containerEl).setName(name).addText((t) => t.setValue(String(dl[key])).onChange(async (v) => { (dl as any)[key] = v || fallback; await apply(); }));
      txt("還沒到期", "textFuture", "{n} 天後到期");
      txt("當天到期", "textToday", "今天到期");
      txt("已經逾期", "textOverdue", "已逾期 {n} 天");
      txt("還沒開始（🛫）", "textStartFuture", "{n} 天後開始");
      txt("當天開始", "textStartToday", "今天開始");
      txt("預定日還沒到（⏳）", "textScheduledFuture", "{n} 天後預定");
      txt("當天預定", "textScheduledToday", "今天預定");
      txt("預定日已過", "textScheduledPast", "預定日已過 {n} 天");
      this.colorSetting(containerEl, "文字顏色", "還沒逾期時；留預設就跟隨主題", dl.color, async (v) => { dl.color = v; await apply(); });
      this.colorSetting(containerEl, "逾期時的顏色", "留預設就用紅色", dl.overdueColor, async (v) => { dl.overdueColor = v; await apply(); });
    }

    // ───────── 自訂事項／任務 ─────────
    containerEl.createEl("h3", { text: "自訂事項/任務" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "在月曆日期上按右鍵 →「建立自訂事項/任務」，用表單設定名稱、類型（事項／任務）、重複（每天／每週／每月…）、時刻、次數與結束方式。可以選「長期」（存在下面指定的位置）或「當日」（寫進事項/任務日記）。每天格子裡要顯示哪些內容，請用月曆工具列的「☰ 月曆內容」按鈕勾選。" });
    {
      const ci = s.customItems;
      const st = ci.storage;
      const rootRow = new Setting(containerEl).setName("長期事項/任務的存放位置")
        .setDesc("根資料夾：所有長期的自訂事項/任務都存在這個資料夾裡（會讀取裡面所有 md 檔案）。留空會用預設的「Tasks List」");
      const preview = rootRow.descEl.createDiv({ cls: "dcal-hint" });
      const showPreview = () => { preview.setText(`→ ${storagePath(s, moment())}`); };
      rootRow.addText((t) => t.setPlaceholder("Tasks List").setValue(st.root).onChange(async (v) => { st.root = v.trim(); showPreview(); await apply(); }));
      rootRow.addButton((b) => b.setButtonText("選資料夾").onClick(() => {
        new FolderPickerModal(this.app, async (f) => { st.root = f.path; showPreview(); await apply(); this.display(); }).open();
      }));
      new Setting(containerEl).setName("子資料夾")
        .setDesc("依建立當天的日期，在根資料夾下再分子資料夾")
        .addDropdown((d) => d.addOptions({ none: "不建立子資料夾", year: "依年（YYYY）", yearMonth: "依年／月（YYYY/MM）" }).setValue(st.sub).onChange(async (v) => { st.sub = v as any; showPreview(); await apply(); }));
      new Setting(containerEl).setName("檔名格式")
        .setDesc("用日期格式，固定的文字用 [] 包起來；例如 [Tasks List]、YYYY-MM [事項]")
        .addText((t) => t.setValue(st.fileFormat).onChange(async (v) => { st.fileFormat = v.trim() || "[Tasks List]"; showPreview(); await apply(); }));
      showPreview();
      {
        const ep = new Setting(containerEl).setName("額外讀取的位置")
          .setDesc("每行一個 md 檔案或資料夾。建立事項/任務時在表單指定了其他儲存位置，會自動加到這裡，之後才讀得到；也可以自己加");
        const st2 = ep.descEl.createDiv({ cls: "dcal-extra-debug" });
        const showEp = () => {
          st2.empty();
          for (const p of ci.extraPaths) { const n = filesUnder(this.app, [p]).length; st2.createDiv({ cls: n ? "dcal-hint" : "dcal-hint is-warn", text: n ? `✓ ${p}（找到 ${n} 個 md 檔案）` : `${p}（目前還沒有）` }); }
        };
        ep.addTextArea((t) => { t.inputEl.rows = 2; t.setValue(ci.extraPaths.join("\n")).onChange(async (v) => { ci.extraPaths = v.split("\n").map((x) => x.trim()).filter(Boolean); showEp(); await apply(); }); });
        showEp();
      }
      // 表單模板：把表單設定存成模板、套用、導出／導入
      {
        const tr = new Setting(containerEl).setName("表單模板的存放位置")
          .setDesc("資料夾（留空＝根目錄），模板存在裡面的「自訂事項模板.md」。在「建立自訂事項/任務」表單可以儲存、套用模板");
        const tp = tr.descEl.createDiv({ cls: "dcal-hint" });
        const showTp = () => { tp.setText(`→ ${templatePath(s)}`); };
        tr.addText((t) => t.setPlaceholder("（根目錄）").setValue(ci.templatesFolder).onChange(async (v) => { ci.templatesFolder = v.trim(); showTp(); await apply(); }));
        tr.addButton((b) => b.setButtonText("選資料夾").onClick(() => {
          new FolderPickerModal(this.app, async (f) => { ci.templatesFolder = f.path; showTp(); await apply(); this.display(); }).open();
        }));
        showTp();
        const listRow = new Setting(containerEl).setName("已儲存的模板");
        const names = listRow.descEl.createDiv({ cls: "dcal-extra-debug" });
        const showList = async () => {
          names.empty();
          const all = await listTemplates(this.app, s);
          if (!all.length) names.createDiv({ cls: "dcal-hint", text: "（還沒有模板）" });
          for (const t of all) {
            const row = names.createDiv({ cls: "dcal-tpl-row" });
            row.createSpan({ text: `${t.name}　${t.type === "task" ? "任務" : "事項"}` });
            row.createEl("button", { text: "刪除" }).onclick = async () => { await deleteTemplate(this.app, s, t.name); await showList(); };
          }
        };
        void showList();
        const ex = new Setting(containerEl).setName("導出模板").setDesc("把目前所有模板寫到指定的檔案（md），可以備份或分享給別人");
        let exPath = "自訂事項模板-匯出.md";
        ex.addText((t) => t.setValue(exPath).onChange((v) => { exPath = v.trim(); }));
        ex.addButton((b) => b.setButtonText("導出").onClick(async () => { const n = await exportTemplates(this.app, s, exPath || "自訂事項模板-匯出.md"); new Notice(`已導出 ${n} 個模板到 ${exPath}`); }));
        const im = new Setting(containerEl).setName("導入模板").setDesc("讀取指定檔案裡的模板（md 或 JSON），同名的更新、新的加入");
        let imPath = "";
        im.addText((t) => t.setPlaceholder("要導入的檔案路徑").onChange((v) => { imPath = v.trim(); }));
        im.addButton((b) => b.setButtonText("導入").onClick(async () => {
          if (!imPath) { new Notice("請先輸入要導入的檔案路徑"); return; }
          const r = await importTemplates(this.app, s, imPath);
          new Notice(r ? `導入完成：新增 ${r.added} 個、更新 ${r.updated} 個` : `找不到檔案：${imPath}`);
          await showList();
        }));
      }
      new Setting(containerEl).setName("事項的排序").setDesc("同一天有好幾個事項時")
        .addDropdown((d) => d.addOptions({ az: "A 到 Z（預設）", za: "Z 到 A", file: "照存放的順序" }).setValue(ci.sort).onChange(async (v) => { ci.sort = v as any; await apply(); }));
      this.colorSetting(containerEl, "事項文字顏色", "", ci.color, async (v) => { ci.color = v; await apply(); });
      const di = s.dayItems;
      new Setting(containerEl).setName("每天最多顯示幾筆")
        .setDesc("超過會顯示「還有 N 筆記錄」，點一下展開、再點收起；0＝依格子大小自動")
        .addText((t) => t.setValue(String(di.max)).onChange(async (v) => { const n = Math.floor(Number(v)); if (n >= 0 && n <= 99) { di.max = n; await apply(); } }));
    }

    // ───────── 開啟方式 ─────────
    new Setting(containerEl).setName("開啟／建立筆記時")
      .setDesc("從月曆開啟或建立日記、週記、事項/任務日記…時，要開在哪個分頁")
      .addDropdown((d) => d.addOptions({ tab: "在新分頁開啟（預設）", current: "在目前分頁開啟" }).setValue(s.openIn).onChange(async (v) => { s.openIn = v as any; await apply(); }));

    // ───────── 額外來源 ─────────
    containerEl.createEl("h3", { text: "額外來源" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "日記圓點／任務清單圓點／時間軸預設只讀取既有的日／週／月記。開啟後可以再加讀其他資料夾或檔案——這些筆記不需要符合日記的檔名格式，而是靠 YAML 裡的日期屬性判斷屬於哪一天。" });
    new Setting(containerEl).setName("啟用").addToggle((t) => t.setValue(s.extraSources.enabled).onChange(async (v) => { s.extraSources.enabled = v; await apply(); this.display(); }));
    if (s.extraSources.enabled) {
      const pathSetting = new Setting(containerEl).setName("路徑").setDesc("每行一個資料夾或檔案路徑，可以寫多個");
      const debugBox = pathSetting.descEl.createDiv({ cls: "dcal-extra-debug" });
      const refreshDebug = () => {
        debugBox.empty();
        const rows = debugExtraSources(this.app, s);
        if (!rows.length) { debugBox.createDiv({ text: "（還沒填路徑）" }); return; }
        for (const r of rows) {
          const line = debugBox.createDiv({ cls: r.exists ? "dcal-hint" : "dcal-hint is-warn" });
          line.setText(r.exists ? `✓ ${r.path}（找到，掃到 ${r.matched} 篇符合日期屬性的筆記）` : `⚠ ${r.path}（找不到這個資料夾或檔案）`);
        }
      };
      pathSetting.addTextArea((t) => {
        t.inputEl.rows = 3;
        t.setValue(s.extraSources.paths.join("\n")).onChange(async (v) => {
          s.extraSources.paths = v.split("\n").map((x) => x.trim()).filter(Boolean);
          await apply();
          refreshDebug();
        });
      });
      refreshDebug();
      new Setting(containerEl).setName("日期屬性名稱").setDesc('例如「創建時間」；這些筆記的 YAML 必須有這個屬性才會被讀到')
        .addText((t) => t.setValue(s.extraSources.dateKey).onChange(async (v) => { s.extraSources.dateKey = v.trim() || "創建時間"; await apply(); refreshDebug(); }));
      new Setting(containerEl).setName("日期格式")
        .setDesc("用來解析上面那個屬性值的格式，例如 YYYY-MM-DD 或 YYYY/MM/DD HH:mm（注意分鐘是小寫 mm，大寫 MM 是月份）；格式對不上時也會嘗試自動辨識常見日期格式")
        .addText((t) => t.setValue(s.extraSources.dateFormat).onChange(async (v) => { s.extraSources.dateFormat = v.trim() || "YYYY-MM-DD"; await apply(); refreshDebug(); }));
    }

    // ───────── 格內模塊 ─────────
    containerEl.createEl("h3", { text: "格內模塊" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "開啟後會直接展開該模塊自己的設定。同一個「插槽」裡的模塊可以拖曳調整顯示順序（見下方「顯示順序」）。" });
    const cellIds = [...this.plugin.registry.cells.keys()];
    new Setting(containerEl)
      .setName("預設組合")
      .setDesc("首次啟用外掛時預設為「標準月曆」。標準月曆：全部關閉，只保留公曆日期數字。全部開啟：啟用所有格內模塊。")
      .addButton((b) =>
        b.setButtonText("標準月曆（全部關閉）").onClick(async () => {
          const others = s.disabledModules.filter((id) => !cellIds.includes(id));
          s.disabledModules = [...others, ...cellIds.filter((id) => !STANDARD_CELL_IDS.includes(id))];
          await apply();
          this.display();
        })
      )
      .addButton((b) =>
        b.setButtonText("全部開啟").onClick(async () => {
          s.disabledModules = s.disabledModules.filter((id) => !cellIds.includes(id));
          for (const m of this.plugin.registry.cells.values()) {
            ensureModulePlaced(s, m.id, m.slot);
          }
          await apply();
          this.display();
        })
      );
    for (const m of this.plugin.registry.cells.values()) {
      const enabled = !s.disabledModules.includes(m.id);
      const row = new Setting(containerEl).setName(m.name).setDesc(`插槽: ${m.slot}`);
      row.addToggle((tg) =>
        tg.setValue(enabled).onChange(async (on) => { this.toggleModule(m.id, on, apply); this.display(); })
      );
      if (enabled) {
        const detail = containerEl.createDiv({ cls: "dcal-module-detail" });
        this.renderModuleDetail(m.id, detail, apply);
      }
    }

    containerEl.createEl("h3", { text: "操作模塊" });
    for (const a of this.plugin.registry.actions.values()) {
      new Setting(containerEl).setName(a.name).setDesc(`id: ${a.id}`).addToggle((tg) =>
        tg.setValue(!s.disabledModules.includes(a.id)).onChange(async (on) => this.toggleModule(a.id, on, apply))
      );
    }

    // ───────── 顯示順序 ─────────
    containerEl.createEl("h3", { text: "顯示順序" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "同一插槽（畫面位置）內的模塊可以拖曳調整先後順序；不同插槽之間（例如公曆數字在左上角、農曆在日期下方）位置本來就不同，無法互相排序。" });
    this.renderOrderEditor(containerEl, apply);

    this.groupIntoTabs(searchWrap);
    if (this.searchBox) this.applySearch(this.searchBox.value);
    scrollTargets.forEach((e, i) => { e.scrollTop = scrollPositions[i]; });
  }

  /**
   * 「起始日期＋已經過多少年月日」的編輯區（顯示另一份年月日的自訂義、起始年月日共用）。
   * 打字只更新草稿，按「保存應用」才驗證並套用，並顯示「尚未保存／已保存／失敗」。
   */
  private renderElapsedEditor(
    container: HTMLElement,
    o: { withName: boolean; name: string; startDate: string; elapsed: Elapsed; desc: string;
         onSave: (d: { name: string; startDate: string; elapsed: Elapsed }) => Promise<void> }
  ) {
    const draft = { name: o.name, startDate: o.startDate, y: String(o.elapsed.y), m: String(o.elapsed.m), d: String(o.elapsed.d) };
    const saved = () => draft.name === o.name && draft.startDate === o.startDate && draft.y === String(o.elapsed.y) && draft.m === String(o.elapsed.m) && draft.d === String(o.elapsed.d);
    // 說明文字放在 Setting 上，輸入欄位放在它下面「獨立一行」（會自動換行），不要全部擠進 Setting 右側的控制區——
    // 那裡空間有限，欄位多了就會被推出畫面外、把整張卡片撐得很高
    const row = new Setting(container).setName("起始日期與已經過的時間").setDesc(o.desc);
    const status = row.descEl.createDiv({ cls: "dcal-save-status" });
    const show = (state: "pending" | "saved" | "failed", msg?: string) => {
      status.removeClass("is-pending", "is-saved", "is-failed");
      status.addClass(`is-${state}`);
      status.setText(state === "pending" ? "● 尚未保存應用" : state === "saved" ? "✓ 已保存應用成功" : `✗ 保存應用失敗${msg ? "：" + msg : ""}`);
    };
    const box = container.createDiv({ cls: "dcal-elapsed" });
    const field = (label: string, key: keyof typeof draft, placeholder: string, narrow = false) => {
      const w = box.createDiv({ cls: narrow ? "dcal-elapsed-field is-narrow" : "dcal-elapsed-field" });
      w.createEl("label", { text: label });
      const input = w.createEl("input", { type: "text", attr: { placeholder } }) as HTMLInputElement;
      input.value = draft[key];
      input.oninput = () => { draft[key] = input.value.trim(); show(saved() ? "saved" : "pending"); };
    };
    if (o.withName) field("名稱（選填）", "name", "例如：創業");
    field("起始日期", "startDate", "YYYY-MM-DD");
    field("已經過：年", "y", "0", true);
    field("月", "m", "0", true);
    field("日", "d", "0", true);
    const save = box.createEl("button", { text: "保存應用", cls: "mod-cta" });
    save.onclick = async () => {
      if (!/^\d{1,4}-\d{2}-\d{2}$/.test(draft.startDate) || !moment(draft.startDate, "YYYY-MM-DD", true).isValid()) { show("failed", "起始日期格式不正確（需為 YYYY-MM-DD 且是真實存在的日期）"); return; }
      const nums = [draft.y, draft.m, draft.d].map((x) => (x === "" ? 0 : Number(x)));
      if (nums.some((n) => !Number.isInteger(n) || n < 0)) { show("failed", "已經過的年／月／日必須是 0 以上的整數"); return; }
      try {
        const d = { name: draft.name, startDate: draft.startDate, elapsed: { y: nums[0], m: nums[1], d: nums[2] } };
        await o.onSave(d);
        o.name = d.name; o.startDate = d.startDate; o.elapsed = d.elapsed;
        show("saved");
      } catch (e) { show("failed", (e as Error).message); }
    };
    show("saved");
  }

  // ───────── 分類列 ─────────
  /** 目前選的分類（重繪設定頁時會記住） */
  activeTab = "general";
  private tabState: { pages: Map<string, HTMLElement>; buttons: Map<string, HTMLElement> } | null = null;

  /**
   * 把整頁設定依標題分成幾個分類（頁面最上面一排按鈕），一次只顯示選到的分類；
   * 搜尋時會暫時顯示全部分類，才找得到其他分類裡的項目。
   */
  private groupIntoTabs(searchWrap: HTMLElement) {
    const root = this.containerEl;
    const kids = Array.from(root.children) as HTMLElement[];
    const bar = root.createDiv({ cls: "dcal-set-tabs" });     // 先建，之後建的分頁都接在它後面
    const pages = new Map<string, HTMLElement>();
    let cur = "general";
    for (const el of kids) {
      if (el === searchWrap) continue;
      if (el.tagName === "H3") cur = tabOf(el.textContent ?? "");
      let page = pages.get(cur);
      if (!page) { page = root.createDiv({ cls: "dcal-set-page", attr: { "data-tab": cur } }); pages.set(cur, page); }
      page.appendChild(el);
    }
    const buttons = new Map<string, HTMLElement>();
    for (const t of SETTING_TABS) {
      if (!pages.has(t.id)) continue;
      const b = bar.createEl("button", { cls: "dcal-set-tab", text: t.label });
      b.onclick = () => { this.activeTab = t.id; this.refreshTabs(); };
      buttons.set(t.id, b);
    }
    if (!pages.has(this.activeTab)) this.activeTab = [...pages.keys()][0] ?? "general";
    this.tabState = { pages, buttons };
    this.refreshTabs();
  }

  private refreshTabs() {
    const st = this.tabState;
    if (!st) return;
    const searching = !!this.searchBox && this.searchBox.value.trim() !== "";
    for (const [id, page] of st.pages) page.toggleClass("dcal-hidden", !searching && id !== this.activeTab);
    for (const [id, b] of st.buttons) b.toggleClass("is-active", id === this.activeTab);
  }

  // ───────── 搜尋 ─────────
  private applySearch(qRaw: string) {
    const q = qRaw.trim().toLowerCase();
    const items = this.containerEl.querySelectorAll(".setting-item");
    for (const el of Array.from(items)) {
      const text = (el.textContent ?? "").toLowerCase();
      (el as HTMLElement).toggleClass("dcal-search-hidden", !!q && !text.includes(q));
    }
    this.refreshTabs();
  }

  private toggleModule(id: string, on: boolean, apply: () => Promise<void>) {
    const s = this.plugin.settings;
    s.disabledModules = s.disabledModules.filter((x) => x !== id);
    if (!on) s.disabledModules.push(id);
    return apply();
  }

  /**
   * 顏色欄位：先選「跟隨主題／預設」或「自訂顏色」，選自訂才出現輸入框；有 opacity 參數時會多一個透明度輸入框。
   * 顏色格式說明固定放在左邊（Setting 的描述欄）。
   *
   * 注意：切換下拉選單時「不」整頁重繪（不呼叫 this.display()）——如果靠「目前存的顏色是否為空」來決定
   * 下拉選單要顯示「預設」或「自訂」，使用者一選「自訂」但還沒打字顏色值仍是空字串，整頁重繪就會把選單
   * 打回「預設」，變成永遠切不過去。這裡改成直接在原地插入／隱藏輸入框，不重建整個設定頁。
   */
  private colorSetting(
    container: HTMLElement, name: string, extraDesc: string,
    value: string, onChange: (v: string) => Promise<void>,
    opacity?: { value: number; onChange: (v: number) => Promise<void> }
  ) {
    const setting = new Setting(container).setName(name).setDesc((extraDesc ? extraDesc + "。" : "") + COLOR_HINT);
    const err = setting.descEl.createDiv({ cls: "dcal-hint is-warn" });

    // 自訂顏色（＋透明度）的輸入框放在「獨立一行」，不跟下拉選單擠在同一列——不然切到自訂時，
    // 輸入框會把這一列的描述文字一起擠到旁邊去，變得很難讀。這裡固定建好這一行，只用 class 切換顯示／隱藏。
    const detailRow = container.createDiv({ cls: "dcal-color-detail dcal-hidden" });
    detailRow.createEl("label", { text: "顏色" });
    const colorInput = detailRow.createEl("input", { type: "text" }) as HTMLInputElement;
    colorInput.value = value;
    colorInput.onkeyup = colorInput.onchange = async () => {
      const v = colorInput.value;
      const r = resolveColor(v);
      err.setText(r.error ?? "");
      if (r.error) return;
      await onChange(v.trim());
    };
    if (opacity) {
      detailRow.createEl("label", { text: "透明度" });
      const opacityInput = detailRow.createEl("input", { type: "text", attr: { placeholder: "0–100" } }) as HTMLInputElement;
      opacityInput.value = String(opacity.value);
      opacityInput.onkeyup = opacityInput.onchange = async () => {
        const n = Number(opacityInput.value);
        if (n >= 0 && n <= 100) await opacity.onChange(n);
      };
    }

    setting.addDropdown((d) =>
      d.addOptions({ default: "跟隨主題／預設", custom: "自訂顏色" }).setValue(value ? "custom" : "default")
        .onChange(async (v) => {
          if (v === "default") { err.setText(""); detailRow.addClass("dcal-hidden"); await onChange(""); }
          else { detailRow.removeClass("dcal-hidden"); }
        })
    );
    if (value) detailRow.removeClass("dcal-hidden");
    return setting;
  }

  /** 模板路徑欄位：點輸入框可挑 .md 檔；旁邊的「選資料夾」按鈕可以先選一個資料夾把路徑填進去，再切回來挑檔案 */
  /**
   * 事項/任務日記的模板：每行一個，可以是單一模板檔，也可以是資料夾（資料夾裡所有 .md 都當作模板）。
   * 有多個模板時，月曆右鍵「建立事項/任務日記」會跳出挑選器讓你選；下面即時列出每一項找到了幾個模板。
   */
  private renderTaskTemplateList(container: HTMLElement, apply: () => Promise<void>) {
    const s = this.plugin.settings;
    const setting = new Setting(container).setName("模板路徑（可多個）")
      .setDesc("每行一個：單一模板檔，或資料夾（資料夾裡所有 .md 都當作模板）。有多個模板時，月曆右鍵「建立事項/任務日記」會跳出挑選器。支援 {{date}}、{{date:格式}}、{{title}}");
    const status = setting.descEl.createDiv({ cls: "dcal-extra-debug" });
    let area: HTMLTextAreaElement;
    const refresh = () => {
      status.empty();
      for (const p of s.taskTemplates) {
        const inFolder = filesUnder(this.app, [p]);
        const file = inFolder.length ? null : resolveTemplate(this.app, p);
        const ok = inFolder.length > 0 || !!file;
        status.createDiv({
          cls: ok ? "dcal-hint" : "dcal-hint is-warn",
          text: inFolder.length > 1 || (inFolder.length === 1 && /\/$/.test(p.trim())) ? `✓ ${p}（資料夾，${inFolder.length} 個模板）` : ok ? `✓ ${inFolder[0]?.path ?? file!.path}` : `⚠ 找不到：${p}`,
        });
      }
    };
    setting.addTextArea((t) => {
      area = t.inputEl as HTMLTextAreaElement;
      t.inputEl.rows = 3;
      t.setPlaceholder("Tasks list/\nTemplates/任務模板.md").setValue(s.taskTemplates.join("\n")).onChange(async (v) => {
        s.taskTemplates = v.split("\n").map((x) => x.trim()).filter(Boolean);
        refresh();
        await apply();
      });
    });
    setting.addButton((b) => b.setButtonText("選資料夾").onClick(() => {
      new FolderPickerModal(this.app, async (f) => {
        const line = f.path + "/";
        if (!s.taskTemplates.includes(line)) s.taskTemplates = [...s.taskTemplates, line];
        area.value = s.taskTemplates.join("\n");
        refresh();
        await apply();
      }).open();
    }));
    refresh();
  }

  private renderTemplatePathField(
    container: HTMLElement, name: string, extraDesc: string,
    value: string, onChange: (v: string) => Promise<void>
  ) {
    const setting = new Setting(container).setName(name)
      .setDesc("點一下會列出 vault 內所有 .md（路徑含「模板」的排前面），點選即可，也可以自行輸入完整路徑；按「選資料夾」可以先選資料夾把路徑帶入。" + extraDesc);
    const hint = setting.descEl.createDiv({ cls: "dcal-hint" });
    const updateHint = (v: string) => {
      const p = v.trim();
      if (!p) { hint.setText(""); hint.toggleClass("is-warn", false); return; }
      const f = resolveTemplate(this.app, p);
      hint.setText(f ? `✓ 使用：${f.path}` : "⚠ 找不到這個檔案，建立時會用空白筆記");
      hint.toggleClass("is-warn", !f);
    };
    let inputRef: HTMLInputElement;
    setting.addText((t) => {
      new FileSuggest(this.app, t.inputEl, () => templateFiles(this.app));
      inputRef = t.inputEl;
      t.setPlaceholder("點一下選擇，或輸入 Templates/Daily.md").setValue(value)
        .onChange(async (v) => { updateHint(v); await onChange(v.trim()); });
    });
    setting.addButton((b) =>
      b.setButtonText("選資料夾").onClick(() => {
        new FolderPickerModal(this.app, async (f) => {
          const v = f.path + "/";
          inputRef.value = v;
          updateHint(v);
          await onChange(v);
        }).open();
      })
    );
    updateHint(value);
    return setting;
  }

  // ───────── 各模塊的細項設定（開啟時才顯示） ─────────
  private renderModuleDetail(id: string, el: HTMLElement, apply: () => Promise<void>) {
    const s = this.plugin.settings;
    switch (id) {
      case "day-items":
        el.createEl("p", { cls: "setting-item-description", text: "顯示哪些內容（自訂事項／任務、任務、筆記名稱）請用月曆工具列的「☰ 月曆內容」按鈕勾選；最多顯示幾筆在上方「自訂事項/任務」設定。" });
        break;
      case "holiday-name":
        new Setting(el).setName("名稱太長時自動換行").setDesc("依格子寬度換行，避免名稱被截掉看不到；預設開啟")
          .addToggle((t) => t.setValue(s.holidayNameWrap).onChange(async (v) => { s.holidayNameWrap = v; await apply(); }));
        break;
      case "festival": case "solar-term":
        el.createEl("p", { cls: "setting-item-description", text: "文字排在哪裡、跟誰同一列，請到最下方的「顯示順序」調整。" });
        break;
      case "rest-work-badge": {
        const rw = s.restWorkBadge;
        el.createEl("p", { cls: "setting-item-description", text: `「${rw.restLabel}」會跟上面下載的節慶／假日連動（放假日自動出現）；「${rw.workLabel}」是補班日。它們和下面的自訂徽章都可以各自設定徽章顏色與整格底色，月曆和年歷都會顯示成相應的顏色。月曆右鍵「新增自訂徽章」可以直接替某一天加上徽章。` });
        const renameLabel = (oldKey: () => string, setKey: (v: string) => void, fallback: string) => async (v: string) => {
          const nv = v.trim() || fallback;
          const old = oldKey();
          if (nv !== old) { rw.badgeColors[nv] = rw.badgeColors[old] ?? { color: "", opacity: 100, bgColor: "", bgOpacity: 20 }; delete rw.badgeColors[old]; rw.bgPriority = rw.bgPriority.map((x) => (x === old ? nv : x)); }
          setKey(nv); await apply(); this.display();
        };
        new Setting(el).setName("休假縮寫").addText((t) => t.setValue(rw.restLabel).onChange(renameLabel(() => rw.restLabel, (v) => (rw.restLabel = v), "休")));
        new Setting(el).setName("補班縮寫").addText((t) => t.setValue(rw.workLabel).onChange(renameLabel(() => rw.workLabel, (v) => (rw.workLabel = v), "班")));
        new Setting(el).setName("顯示位置")
          .addDropdown((d) =>
            d.addOptions({ inside: "格子內", border: "邊框上" }).setValue(rw.position)
              .onChange(async (v) => { rw.position = v as any; await apply(); })
          )
          .addDropdown((d) =>
            d.addOptions({ left: "靠左", center: "居中", right: "靠右" }).setValue(rw.align)
              .onChange(async (v) => { rw.align = v as any; await apply(); })
          );

        // 自訂徽章：打字時只存草稿（不觸發月曆重繪），按「保存應用」才真正生效
        const customSetting = new Setting(el).setName("自訂徽章")
          .setDesc('每行「標籤 日期規則」，標籤可以用 "" 包起來。休／班會跟下載的節慶／假日連動，這裡是額外的自訂徽章；日期規則的寫法見下方（每一條都必須指定年份或次數）。');
        const status = customSetting.descEl.createDiv({ cls: "dcal-save-status" });
        const badgeRules = customSetting.descEl.createEl("details");
        badgeRules.createEl("summary", { text: "日期規則的寫法（點開查看）" });
        badgeRules.createEl("pre", { text: RULE_HELP });
        const badgeErr = customSetting.descEl.createDiv({ cls: "dcal-hint is-warn" });
        const showErrors = () => { const e = parseCustomBadgesDetailed(rw.custom).errors; badgeErr.setText(e.length ? e.map((x) => `⚠ 「${x.line}」：${x.message}`).join("\n") : ""); };
        const updateStatus = (state: "pending" | "saved" | "failed") => {
          status.removeClass("is-pending", "is-saved", "is-failed");
          if (state === "pending") { status.addClass("is-pending"); status.setText("● 尚未保存應用"); }
          else if (state === "saved") { status.addClass("is-saved"); status.setText("✓ 已保存應用成功"); }
          else { status.addClass("is-failed"); status.setText("✗ 保存應用失敗"); }
        };
        customSetting.addTextArea((t) => {
          t.inputEl.rows = 4;
          t.setValue(rw.custom).onChange(async (v) => {
            rw.custom = v;
            updateStatus(rw.custom !== rw.customSaved ? "pending" : "saved");
            showErrors();
            await this.plugin.saveSettings(); // 只存草稿到硬碟，不觸發月曆重繪
          });
        });
        customSetting.addButton((b) =>
          b.setButtonText("保存應用").setCta().onClick(async () => {
            try {
              rw.customSaved = rw.custom;
              await apply();
              updateStatus("saved");
              this.display();
            } catch (e) {
              updateStatus("failed");
            }
          })
        );
        updateStatus(rw.custom !== rw.customSaved ? "pending" : "saved");
        showErrors();

        new Setting(el).setName("徽章本身（小標籤）的優先順序")
          .setDesc("最左邊＝最優先。「自訂優先」讓自訂徽章排在休／班前面，「標準優先」則相反")
          .addDropdown((d) =>
            d.addOptions({ standard: "標準（休／班）優先", custom: "自訂徽章優先" }).setValue(rw.priority)
              .onChange(async (v) => { rw.priority = v as any; await apply(); })
          );

        {
          const labels = [...new Set<string>([rw.restLabel, rw.workLabel, ...parseCustomBadges(rw.customSaved).map((d) => d.label)])];
          for (const l of labels) if (!rw.bgPriority.includes(l)) rw.bgPriority.push(l);
          rw.bgPriority = rw.bgPriority.filter((l) => labels.includes(l));

          el.createEl("p", { cls: "setting-item-description", text: "假日底色的優先順序：同一天如果命中好幾個徽章，整格底色只會用其中一個——拖曳調整下面的順序，最上面的優先。清單依已保存應用的徽章自動列出。" });
          if (rw.bgPriority.length > 1) this.renderSimpleOrderList(el, rw.bgPriority, apply);

          el.createEl("p", { cls: "setting-item-description", text: "各徽章的顏色（依已保存應用的徽章文字自動列出）：" });
          for (const label of labels) {
            const entry = rw.badgeColors[label] ?? (rw.badgeColors[label] = { color: "", opacity: 100, bgColor: "", bgOpacity: 20 });
            el.createEl("p", { cls: "setting-item-description dcal-badge-group-label", text: `「${label}」` });
            this.colorSetting(el, "徽章底色（小標籤本身）", "", entry.color, async (v) => { entry.color = v; await apply(); }, {
              value: entry.opacity, onChange: async (v) => { entry.opacity = v; await apply(); },
            });
            this.colorSetting(el, "假日底色（整格背景）", "", entry.bgColor, async (v) => { entry.bgColor = v; await apply(); }, {
              value: entry.bgOpacity, onChange: async (v) => { entry.bgOpacity = v; await apply(); },
            });
          }
        }
        break;
      }
      case "holiday-bg":
        el.createEl("p", { cls: "setting-item-description", text: "顏色、透明度與優先順序統一在「休／班／自訂徽章」的設定裡調整（兩者共用同一組徽章資料）。這裡的開關只決定假日底色要不要顯示。" });
        break;
      case "note-dot":
        this.renderMarkSection(el, s.noteMarks.diary, apply);
        break;
      case "task-dot": {
        this.renderMarkSection(el, s.noteMarks.task, apply);
        const tp = s.noteMarks.taskPending;
        el.createEl("p", { cls: "setting-item-description", text: "還有任務沒勾選時，當天（以及週統計的那一週）會優先顯示成「符號＋未完成數量」，例如 ⚠ 1；全部完成就變回上面設定的圓點樣式。" });
        new Setting(el).setName("未完成時的顯示符號").setDesc("預設 ⚠")
          .addText((t) => t.setValue(tp.symbol).onChange(async (v) => { tp.symbol = v.trim() || "⚠"; await apply(); }));
        this.colorSetting(el, "未完成時的顏色", "預設紅色", tp.color, async (v) => { tp.color = v; await apply(); });
        break;
      }
      default:
        break;
    }
  }

  private renderMarkSection(el: HTMLElement, cfg: MarkCfg, apply: () => Promise<void>) {
    new Setting(el).setName("顯示位置")
      .setDesc("依顯示順序排列：併入下方「顯示順序」可調整的區域，能跟農曆／節慶等一起拖曳排序；固定左下角：維持在當日格子左下角，不參與排序")
      .addDropdown((d) =>
        d.addOptions({ order: "依顯示順序排列（預設）", fixed: "固定左下角" }).setValue(cfg.position)
          .onChange(async (v) => { cfg.position = v as any; reconcileDotPosition(this.plugin.settings); await apply(); this.display(); })
      );
    const modeValue = cfg.mode === "number" ? "number" : cfg.autoSize ? "auto" : "dots";
    new Setting(el).setName("顯示方式")
      .setDesc("圓點：超過下面設定的點數就改顯示數字；數字：一律顯示數字；依格子大小：格子太窄放不下時自動改顯示數字")
      .addDropdown((d) =>
        d.addOptions({ dots: "圓點", number: "數字", auto: "依格子大小自動轉換成數字" }).setValue(modeValue)
          .onChange(async (v) => {
            cfg.mode = v === "number" ? "number" : "dots";
            cfg.autoSize = v === "auto";
            await apply();
            this.display();
          })
      );
    if (cfg.mode === "dots") {
      new Setting(el).setName("最多顯示幾點").setDesc("超過這個數量就改顯示成數字")
        .addText((t) => t.setValue(String(cfg.maxDots)).onChange(async (v) => {
          const n = Math.floor(Number(v));
          if (n >= 1 && n <= 50) { cfg.maxDots = n; await apply(); }
        }));
    }
    new Setting(el).setName("數字旁也顯示一個圓點")
      .setDesc("顯示成數字時（包含超過最多點數、或依格子大小自動轉換時），在數字旁邊再放一個圓點")
      .addToggle((t) => t.setValue(cfg.beside).onChange(async (v) => { cfg.beside = v; await apply(); }));
    new Setting(el).setName("樣式").addDropdown((d) =>
      d.addOptions({ circle: "圓形", square: "方形", diamond: "菱形", x: "X 型", custom: "自訂符號" })
        .setValue(cfg.shape).onChange(async (v) => { cfg.shape = v as DotShape; await apply(); this.display(); })
    );
    if (cfg.shape === "custom") {
      const row = new Setting(el).setName("自訂符號").setDesc("僅限單一個標準 Unicode 字元／emoji，其他一律拒絕並顯示錯誤原因");
      const err = row.descEl.createDiv({ cls: "dcal-hint is-warn" });
      row.addText((t) =>
        t.setValue(cfg.custom).onChange(async (v) => {
          const problem = validateGlyph(v);
          if (problem) { err.setText("⚠ " + problem); return; }
          err.setText("");
          cfg.custom = v.trim();
          await apply();
        })
      );
    }
    this.colorSetting(el, "顏色", "", cfg.color, async (v) => { cfg.color = v; await apply(); });
    const pathRow = new Setting(el).setName("讀取路徑")
      .setDesc("只計算這些 md 檔案或資料夾裡的筆記（可以填多個，每行一個）；留空＝預設來源（日記與額外來源，任務清單圓點另外包含事項/任務日記）。不是日記命名格式的筆記，要靠額外來源設定的日期屬性（預設「創建時間」）判斷屬於哪一天");
    const pathStatus = pathRow.descEl.createDiv({ cls: "dcal-extra-debug" });
    const refreshPaths = () => {
      pathStatus.empty();
      for (const p of cfg.paths) {
        const n = filesUnder(this.app, [p]).length;
        pathStatus.createDiv({ cls: n ? "dcal-hint" : "dcal-hint is-warn", text: n ? `✓ ${p}（找到 ${n} 個 md 檔案）` : `⚠ ${p}（找不到）` });
      }
    };
    pathRow.addTextArea((t) => {
      t.inputEl.rows = 2;
      t.setValue(cfg.paths.join("\n")).onChange(async (v) => { cfg.paths = v.split("\n").map((x) => x.trim()).filter(Boolean); refreshPaths(); await apply(); });
    });
    refreshPaths();
  }

  // ───────── 節慶快取列表 ─────────
  private renderCacheList(containerEl: HTMLElement) {
    const s = this.plugin.settings;
    const keys = Object.keys(s.cache.holiday);
    if (!keys.length) return;
    const wrap = containerEl.createDiv({ cls: "dcal-cache-list" });
    wrap.createEl("p", { cls: "setting-item-description", text: "已下載的快取：" });
    const table = wrap.createEl("table", { cls: "dcal-fmt-table" });
    for (const key of keys.sort()) {
      const [src, country, year] = key.split(":");
      const label = HOLIDAY_SOURCE_LABEL[src] ?? src;
      const at = s.cache.holidayMeta?.[key];
      const tr = table.createEl("tr");
      tr.createEl("td", { text: `${label}${country !== "-" ? `（${country}）` : ""} ${year}` });
      tr.createEl("td", { text: at ? moment(at).format("YYYY-MM-DD HH:mm") : "（未記錄時間）" });
    }
  }

  // ───────── 導入／匯出節慶 JSON ─────────
  private renderHolidayImportExport(containerEl: HTMLElement, apply: () => Promise<void>) {
    const s = this.plugin.settings;
    const importSetting = new Setting(containerEl)
      .setName("導入自訂節慶 JSON")
      .setDesc("不論選哪個資料來源，這裡導入的資料都會與下載的結果疊加（同一天以此為準）。解析失敗時只會提示錯誤，已下載或先前已導入的資料不受影響。");
    const help = importSetting.descEl.createEl("details", { cls: "dcal-help" });
    help.createEl("summary", { text: "支援的 JSON 格式與範例（點開查看）" });
    help.createEl("pre", { cls: "dcal-json-example", text: HOLIDAY_JSON_EXAMPLE });
    help.createEl("p", { text: "陣列每筆的欄位：date（必填，YYYY-MM-DD 或 YYYYMMDD）、name／localName 皆可、isRest（是否放假，預設 true）、isMakeupWork（是否補班，預設 false）。" });

    let importText = "";
    importSetting.addTextArea((t) => { t.inputEl.rows = 4; t.onChange((v) => (importText = v)); });
    const err = importSetting.descEl.createDiv({ cls: "dcal-hint is-warn" });
    importSetting.addButton((b) =>
      b.setButtonText("解析並加入").onClick(async () => {
        try {
          const list = normalizeHolidayJson(JSON.parse(importText));
          for (const e of list) s.holiday.custom[e.date] = e;
          err.setText("");
          await apply();
          new Notice(`已加入 ${list.length} 筆節慶資料`);
        } catch (e) {
          err.setText("⚠ 匯入失敗：" + (e as Error).message + "（已下載的資料不受影響）");
        }
      })
    );
    const customCount = Object.keys(s.holiday.custom).length;
    if (customCount) {
      new Setting(containerEl).setName(`已導入 ${customCount} 筆自訂節慶`)
        .addButton((b) => b.setButtonText("全部清除").onClick(async () => { s.holiday.custom = {}; await apply(); this.display(); }));
    }

    const keys = Object.keys(s.cache.holiday);
    if (!keys.length) return;
    const exportSetting = new Setting(containerEl).setName("匯出節慶資料").setDesc("把已下載的某個來源／年份匯出成檔案，方便備份或分享");
    exportSetting.settingEl.addClass("dcal-export-setting");
    let chosenKey = keys[0];
    let format: "json" | "md" = "json";
    let folder = "";
    exportSetting.addDropdown((d) => {
      const o: Record<string, string> = {};
      for (const k of keys.sort()) {
        const [src, country, year] = k.split(":");
        o[k] = `${HOLIDAY_SOURCE_LABEL[src] ?? src}${country !== "-" ? `（${country}）` : ""} ${year}`;
      }
      d.addOptions(o).setValue(chosenKey).onChange((v) => (chosenKey = v));
    });
    exportSetting.addDropdown((d) => d.addOptions({ json: ".json", md: ".md" }).setValue(format).onChange((v) => (format = v as any)));
    exportSetting.addText((t) => { new FolderSuggest(this.app, t.inputEl); t.setPlaceholder("匯出到哪個資料夾").onChange((v) => (folder = v.trim())); });
    exportSetting.addButton((b) =>
      b.setButtonText("匯出").onClick(async () => {
        const list = s.cache.holiday[chosenKey] ?? [];
        const name = chosenKey.replace(/:/g, "-");
        const path = `${folder ? folder.replace(/\/+$/, "") + "/" : ""}${name}.${format}`;
        const content = format === "json" ? JSON.stringify(list, null, 2) : `# ${name}\n\n\`\`\`json\n${JSON.stringify(list, null, 2)}\n\`\`\`\n`;
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
          if (this.app.vault.getAbstractFileByPath(path)) { new Notice("已存在同名檔案：" + path); return; }
          await this.app.vault.create(path, content);
          new Notice("已匯出：" + path);
        } catch (e) {
          new Notice("匯出失敗：" + (e as Error).message);
        }
      })
    );
  }

  /** 通用的拖曳排序清單，直接操作傳入的字串陣列（原地排序） */
  private renderSimpleOrderList(container: HTMLElement, items: string[], apply: () => Promise<void>) {
    const list = container.createDiv({ cls: "dcal-order-list" });
    let dragLabel: string | null = null;
    const redraw = () => {
      list.empty();
      for (const label of items) {
        const row = list.createDiv({ cls: "dcal-order-item", attr: { draggable: "true" } });
        row.createSpan({ cls: "dcal-order-handle", text: "⠿" });
        row.createSpan({ text: label });
        row.ondragstart = () => { dragLabel = label; };
        row.ondragover = (e) => e.preventDefault();
        row.ondrop = async (e) => {
          e.preventDefault();
          if (!dragLabel || dragLabel === label) return;
          const from = items.indexOf(dragLabel);
          const to = items.indexOf(label);
          if (from < 0 || to < 0) return;
          items.splice(to, 0, items.splice(from, 1)[0]);
          await apply();
          redraw();
        };
      }
    };
    redraw();
  }

  // ───────── 顯示順序（拖曳） ─────────
  private renderOrderEditor(containerEl: HTMLElement, apply: () => Promise<void>) {
    const s = this.plugin.settings;
    const nameOf = (id: string) => this.plugin.registry.cells.get(id)?.name ?? id;

    // ── 日期下方的資訊區：每個項目預設各自一列；把一個項目拖到另一個項目「後面」，兩個就會顯示在同一列 ──
    containerEl.createEl("div", { cls: "dcal-order-label", text: "日期下方的資訊（由上到下一列一列顯示）" });
    containerEl.createEl("p", { cls: "setting-item-description", text: "拖曳項目：放到另一個項目上＝排到那個項目後面，同一列同時顯示；放到列與列之間的空隙＝獨立成一列。拖曳最左邊的 ⠿ 可以整列上下移動。灰色的是目前關閉的模塊。" });
    const box = containerEl.createDiv({ cls: "dcal-order-box dcal-info-order" });
    let drag: { type: "item"; id: string } | { type: "row"; index: number } | null = null;
    const redraw = () => {
      box.empty();
      const gap = (index: number) => {
        const g = box.createDiv({ cls: "dcal-order-gap", text: "" });
        g.ondragover = (e) => e.preventDefault();
        g.ondrop = async (e) => {
          e.preventDefault();
          if (drag?.type === "item") s.infoRows = moveInfoItem(s.infoRows, drag.id, { kind: "newRow", index });
          else if (drag?.type === "row") s.infoRows = moveInfoRow(s.infoRows, drag.index, drag.index < index ? index - 1 : index);
          drag = null; await apply(); redraw();
        };
      };
      s.infoRows.forEach((row, ri) => {
        gap(ri);
        const rowEl = box.createDiv({ cls: "dcal-order-row" });
        const handle = rowEl.createSpan({ cls: "dcal-order-handle", text: "⠿", attr: { draggable: "true", title: "拖曳整列" } });
        handle.ondragstart = () => { drag = { type: "row", index: ri }; };
        for (const id of row) {
          const chip = rowEl.createSpan({ cls: "dcal-order-chip", text: nameOf(id), attr: { draggable: "true" } });
          if (s.disabledModules.includes(id)) chip.addClass("is-disabled");
          chip.ondragstart = (e) => { e.stopPropagation(); drag = { type: "item", id }; };
          chip.ondragover = (e) => e.preventDefault();
          chip.ondrop = async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (drag?.type !== "item") return;
            s.infoRows = moveInfoItem(s.infoRows, drag.id, { kind: "after", targetId: id });
            drag = null; await apply(); redraw();
          };
        }
      });
      gap(s.infoRows.length);
    };
    redraw();

    // ── 其他固定位置（左上、右上、左下…）：同一個位置有 2 個以上模塊時，可以拖曳調整先後 ──
    for (const slot of FIXED_SLOTS) {
      const ids = s.layout[slot].filter((id) => !s.disabledModules.includes(id));
      if (ids.length < 2) continue;
      const fbox = containerEl.createDiv({ cls: "dcal-order-box" });
      fbox.createEl("div", { cls: "dcal-order-label", text: `位置：${slot}` });
      const list = fbox.createDiv({ cls: "dcal-order-list" });
      let dragId: string | null = null;
      const draw = () => {
        list.empty();
        for (const id of s.layout[slot]) {
          if (s.disabledModules.includes(id)) continue;
          const row = list.createDiv({ cls: "dcal-order-item", attr: { draggable: "true" } });
          row.createSpan({ cls: "dcal-order-handle", text: "⠿" });
          row.createSpan({ text: nameOf(id) });
          row.ondragstart = () => { dragId = id; };
          row.ondragover = (e) => e.preventDefault();
          row.ondrop = async (e) => {
            e.preventDefault();
            if (!dragId || dragId === id) return;
            const arr = s.layout[slot];
            const from = arr.indexOf(dragId);
            const to = arr.indexOf(id);
            if (from < 0 || to < 0) return;
            arr.splice(to, 0, arr.splice(from, 1)[0]);
            await apply();
            draw();
          };
        }
      };
      draw();
    }
  }

  private renderFormatHelp(containerEl: HTMLElement) {
    const det = containerEl.createEl("details", { cls: "dcal-help" });
    det.createEl("summary", { text: "檔名格式怎麼寫？（點開說明）" });
    det.createEl("p", { text: '用 [方括號] 或 "雙引號" 包住的文字會原樣輸出，不當作格式；- _ / 及空白、中文字本來就不會被當作格式。' });
    for (const g of TOKEN_DOCS) {
      const p = det.createEl("p");
      p.createEl("strong", { text: g.group + "：" });
      p.createSpan({ text: g.items.map(([k, d]) => `${k}（${d}）`).join("、") });
    }
    const p2 = det.createEl("p");
    p2.createEl("strong", { text: "可用變數：" });
    p2.createSpan({ text: VAR_DOCS.map(([k, d]) => `${k}（${d}）`).join("、") });
    det.createEl("p", { text: "範例與輸出結果（以現在時間試算）：" });
    const table = det.createEl("table", { cls: "dcal-fmt-table" });
    const now = moment();
    for (const ex of FORMAT_EXAMPLES) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: ex });
      tr.createEl("td", { text: "→" });
      let out = "";
      try { out = renderFormat(ex, now); } catch { out = "（格式錯誤）"; }
      tr.createEl("td", { text: out });
    }
  }

  /** extra=true 時預覽「新日記的命名規則」（s.naming.extraFormat），而不是這個週期自己的主要格式 */
  private paintFormatPreview(el: HTMLElement, kind: PeriodKind, format: string, extra = false) {
    el.empty();
    const s = this.plugin.settings;
    const cfg = s.periodic[kind];
    const problem = formatProblem(kind, [cfg.subfolder, format].filter(Boolean).join("/"));
    try {
      const path = relPath(kind, moment(), s, { extra });
      el.createSpan({ text: `→ ${cfg.folder ? cfg.folder + "/" : ""}${path}.md` });
    } catch {
      el.createSpan({ text: "（格式解析失敗）" });
    }
    if (problem) el.createDiv({ cls: "dcal-hint is-warn", text: "⚠ " + problem });
  }

  private refreshFormatPreview(kind: PeriodKind, extra = false) {
    const s = this.plugin.settings;
    const sel = extra ? `.dcal-fmt-preview-daily-extra` : `.dcal-fmt-preview-${kind}`;
    const el = this.containerEl.querySelector(sel) as HTMLElement | null;
    if (el) this.paintFormatPreview(el, kind, extra ? s.naming.extraFormat : s.periodic[kind].format, extra);
  }
}

/** 一般檔案（非 .md）路徑挑選，用於選字體檔 */
class FileAnySuggest extends FileSuggest {
  constructor(app: App, input: HTMLInputElement) {
    super(app, input, () => (app as any).vault.getFiles());
  }
}
