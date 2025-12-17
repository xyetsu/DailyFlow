import { App, TFile, moment, FuzzySuggestModal, Notice } from "obsidian";
import DailyLogPlugin from "./main";

// --- Helpers (Suggest Modal) ---
class TagSuggest extends FuzzySuggestModal<string> {
	items: string[];
	inputEl: HTMLInputElement;
	constructor(app: App, items: string[], inputEl: HTMLInputElement) {
		super(app);
		this.items = items;
		this.inputEl = inputEl;
	}
	getItems() {
		return this.items;
	}
	getItemText(item: string) {
		return `#${item}`;
	}
	onChooseItem(item: string) {
		const el = this.inputEl;
		const val = el.value;
		const caret = el.selectionStart ?? val.length;

		const prefix = val.slice(0, caret);
		const lastHash = prefix.lastIndexOf("#");

		if (lastHash < 0) {
			el.value = val + ` #${item} `;
			return;
		}

		const before = val.slice(0, lastHash);
		const after = val.slice(caret);
		el.value = `${before}#${item} ${after}`;

		const pos = (before + "#" + item + " ").length;
		el.setSelectionRange(pos, pos);
		el.focus();
	}
}

class FileLinkSuggest extends FuzzySuggestModal<TFile> {
	items: TFile[];
	inputEl: HTMLInputElement;
	constructor(app: App, files: TFile[], inputEl: HTMLInputElement) {
		super(app);
		this.items = files;
		this.inputEl = inputEl;
	}
	getItems() {
		return this.items;
	}
	getItemText(f: TFile) {
		return f.basename || f.path;
	}
	onChooseItem(f: TFile) {
		const el = this.inputEl;
		const val = el.value;
		const caret = el.selectionStart ?? val.length;

		const prefix = val.slice(0, caret);
		const lastBracket = prefix.lastIndexOf("[[");

		if (lastBracket < 0) {
			el.value = val + ` [[${f.basename}]] `;
			return;
		}

		const before = val.slice(0, lastBracket);
		const after = val.slice(caret);
		const insertion = `[[${f.path}|${f.basename}]]`;

		el.value = `${before}${insertion} ${after}`;
		const pos = (before + insertion + " ").length;
		el.setSelectionRange(pos, pos);
		el.focus();
	}
}

type EventModel = {
	idx: number;
	raw: string;
	key: string;
	body: string;
	entryTime: string | null;
	recordedTime: string | null;
	text: string;
};

export class DailyLogEmbed {
	plugin: DailyLogPlugin;
	app: App;
	containerEl: HTMLElement;
	currentDate: string;

	// --- Состояние инициализации ---
	private isInitialized = false;

	// --- Ссылки на контейнеры ---
	private habitsContainer: HTMLElement | null = null;
	private logListContainer: HTMLElement | null = null;
	private onThisDayContainer: HTMLElement | null = null;

	// --- Ссылки на элементы формы ---
	private timeInputEl: HTMLInputElement | null = null;
	private textInputEl: HTMLInputElement | null = null;
	private dateInputEl: HTMLInputElement | null = null;
	private todayBtnEl: HTMLElement | null = null; // Ссылка на кнопку "Сегодня"

	// --- Overlay refs ---
	private editOverlayEl: HTMLElement | null = null;

	// Debounce timer
	private _modifyTimer: number | null = null;

	constructor(el: HTMLElement, plugin: DailyLogPlugin, currentDate: string) {
		this.containerEl = el;
		this.plugin = plugin;
		this.app = plugin.app;
		this.currentDate = currentDate;

		if (!this.containerEl.style.position)
			this.containerEl.style.position = "relative";
		this.containerEl.addClass("df-container");

		this.plugin.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!file || typeof (file as any).path !== "string") return;
				if (file.path === this.getFilePath()) {
					this.triggerRefresh();
				}
			})
		);
	}

	triggerRefresh() {
		if (this._modifyTimer !== null) window.clearTimeout(this._modifyTimer);
		this._modifyTimer = window.setTimeout(() => {
			this._modifyTimer = null;
			this.refreshData();
		}, 100);
	}

	getFolder(dateStr: string = this.currentDate) {
		return `Журнал/Ежедневные/${dateStr.slice(0, 4)}/${dateStr.slice(
			5,
			7
		)}`;
	}

	getFilePath(dateStr: string = this.currentDate) {
		return `${this.getFolder(dateStr)}/${dateStr}.md`;
	}

	async getFileOrNull(
		dateStr: string = this.currentDate
	): Promise<TFile | null> {
		const path = this.getFilePath(dateStr);
		return (this.app.vault.getAbstractFileByPath(path) as TFile) || null;
	}

	normalizeKey(k: string) {
		return k ? k.replace(/::\s*$/, "") : k;
	}
	escapeHtml(s: string) {
		if (!s) return "";
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	escapeRegExp(s: string) {
		return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// ============================================================
	// ГЛАВНЫЙ ЦИКЛ РЕНДЕРА
	// ============================================================
	async render() {
		this.closeEditOverlay();

		if (!this.isInitialized) {
			this.buildLayoutStructure();
			this.isInitialized = true;
		}

		await this.refreshData();
	}

	// Каркас
	buildLayoutStructure() {
		this.containerEl.empty();

		// 1. Привычки
		this.habitsContainer = this.containerEl.createEl("div", {
			cls: "df-habits-list",
		});

		// 2. Разделитель
		this.createDivider();

		// 3. Блок "В этот день" (Перемещен СЮДА: Под разделитель, над логом)
		this.onThisDayContainer = this.containerEl.createEl("div", {
			cls: "df-on-this-day-container",
		});
		this.onThisDayContainer.style.display = "none"; // Скрыт по умолчанию

		// 4. Список событий (Текущий лог)
		this.logListContainer = this.containerEl.createEl("ul", {
			cls: "df-log-list",
		});
		this.logListContainer.style.position = "relative";

		// 5. Форма ввода
		this.createInputForm();

		// 6. Навигация по датам
		this.createDateNavigationBlock();
	}

	createDivider() {
		const divContainer = this.containerEl.createEl("div", {
			cls: "df-divider",
		});
		divContainer.createEl("span", {
			cls: "df-divider-label",
			text: "day log",
		});
		divContainer.createEl("div", { cls: "df-divider-line" });
	}

	async refreshData() {
		// Обновляем видимость кнопки "Сегодня"
		this.updateTodayButtonVisibility();

		const file = await this.getFileOrNull();

		// Обработка текущего дня
		if (!file) {
			if (this.logListContainer) {
				this.logListContainer.empty();
				const msg = this.logListContainer.createEl("li", {
					cls: "df-msg-empty",
				});
				msg.createSpan({
					text: `Заметка ${this.currentDate} не найдена.`,
				});
			}
			if (this.habitsContainer) this.habitsContainer.empty();
		} else {
			const content = await this.app.vault.read(file);
			const cache = this.app.metadataCache.getFileCache(file);

			if (this.habitsContainer) {
				this.updateHabitsUI(file, cache?.frontmatter);
			}

			if (this.logListContainer) {
				this.updateLogListUI(content, file);
			}
		}

		// Обработка "В этот день" (не зависит от существования файла текущего дня)
		if (this.onThisDayContainer) {
			await this.updateOnThisDayUI();
		}
	}

	updateTodayButtonVisibility() {
		if (this.todayBtnEl) {
			const todayStr = moment().format("YYYY-MM-DD");
			if (this.currentDate === todayStr) {
				this.todayBtnEl.style.display = "none";
			} else {
				this.todayBtnEl.style.display = ""; // восстановить display (flex/inline-block из CSS)
			}
		}
	}

	// ============================================================
	// UI UPDATERS
	// ============================================================

	updateHabitsUI(file: TFile, frontmatter: any) {
		const habits = this.plugin.settings.habits;
		if (this.habitsContainer!.children.length !== habits.length) {
			this.habitsContainer!.empty();
			habits.forEach((habit, idx) => {
				const row = this.habitsContainer!.createEl("div", {
					cls: "df-habit-row",
				});
				row.setAttribute("data-habit-key", habit.key);

				const left = row.createEl("div", { cls: "df-habit-label" });
				left.innerHTML = `${habit.iconSvg} ${habit.key}`;

				if (habit.type === "checkbox") {
					const cb = row.createEl("input", { type: "checkbox" });
					cb.addClass("df-habit-checkbox");
					cb.onchange = async () => {
						await this.updateFrontmatter(
							file,
							habit.key,
							cb.checked
						);
					};
				} else {
					const inp = row.createEl("input", {
						type: habit.type === "number" ? "number" : "text",
					});
					inp.addClass("df-habit-input");
					inp.onblur = async () => {
						const newVal = inp.value;
						const saveVal =
							habit.type === "number"
								? newVal === ""
									? null
									: Number(newVal)
								: newVal;
						await this.updateFrontmatter(file, habit.key, saveVal);
					};
				}
			});
		}

		const rows = Array.from(this.habitsContainer!.children);
		rows.forEach((row: HTMLElement, idx) => {
			const habit = habits[idx];
			if (!habit) return;
			const val = frontmatter ? frontmatter[habit.key] : null;

			if (habit.type === "checkbox") {
				const cb = row.querySelector(
					"input[type='checkbox']"
				) as HTMLInputElement;
				if (cb) cb.checked = val === true;
			} else {
				const inp = row.querySelector(
					"input:not([type='checkbox'])"
				) as HTMLInputElement;
				if (inp) {
					if (document.activeElement === inp) {
						return;
					}
					const strVal =
						val !== undefined && val !== null ? String(val) : "";
					inp.value = strVal;
				}
			}
		});
	}

	updateLogListUI(content: string, file: TFile) {
		this.logListContainer!.empty();
		const lines = content.split("\n");
		const events: EventModel[] = [];
		for (let i = 0; i < lines.length; i++) {
			const ev = this.parseEventLine(lines[i], i);
			if (ev) events.push(ev);
		}
		const iconMap = this.getIconMap();
		events.forEach((ev, posIndex) => {
			const li = this.renderEventCard(ev, iconMap, posIndex, file, false);
			this.logListContainer!.appendChild(li);
		});
	}

	// --- Логика "В этот день" ---
	async updateOnThisDayUI() {
		this.onThisDayContainer!.empty();

		// Поиск в обе стороны: -5 лет ... +5 лет
		const range = 5;
		const baseDate = moment(this.currentDate);
		const foundYears: { year: number; file: TFile }[] = [];

		// Проходим от -5 до +5, исключая 0 (текущий год)
		for (let i = -range; i <= range; i++) {
			if (i === 0) continue;

			// add(i, 'years') работает корректно и для отрицательных чисел
			const targetDate = baseDate.clone().add(i, "years");
			const dateStr = targetDate.format("YYYY-MM-DD");

			const file = await this.getFileOrNull(dateStr);
			if (file) {
				foundYears.push({ year: targetDate.year(), file });
			}
		}

		// Если ничего не нашли - скрываем контейнер и выходим
		if (foundYears.length === 0) {
			this.onThisDayContainer!.style.display = "none";
			return;
		}

		// Если нашли - показываем контейнер
		this.onThisDayContainer!.style.display = "block";

		// Сортируем: сначала старые года, потом будущие
		foundYears.sort((a, b) => a.year - b.year);

		// Заголовок секции
		const header = this.onThisDayContainer!.createEl("div", {
			cls: "df-otd-header",
		});
		header.createSpan({ text: "В этот день" });

		const iconMap = this.getIconMap();

		for (const item of foundYears) {
			const details = this.onThisDayContainer!.createEl("details", {
				cls: "df-otd-details",
			});
			const summary = details.createEl("summary", {
				cls: "df-otd-summary",
			});

			// Добавляем маркер года (например "2023" или "2025")
			summary.setText(String(item.year));

			const contentDiv = details.createEl("div", {
				cls: "df-otd-content",
			});

			const content = await this.app.vault.read(item.file);
			const lines = content.split("\n");
			const ul = contentDiv.createEl("ul", {
				cls: "df-log-list df-otd-list",
			});

			let hasEvents = false;
			for (let i = 0; i < lines.length; i++) {
				const ev = this.parseEventLine(lines[i], i);
				if (ev) {
					// Read-only
					const li = this.renderEventCard(
						ev,
						iconMap,
						i,
						item.file,
						true
					);
					ul.appendChild(li);
					hasEvents = true;
				}
			}

			if (!hasEvents) {
				const empty = ul.createEl("li", { cls: "df-msg-empty" });
				empty.setText("Нет записей");
				empty.style.fontSize = "0.8em";
			}
		}
	}

	getIconMap() {
		const iconMap: Record<string, string> = {};
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			iconMap[norm] = k.iconSvg || "";
		});
		return iconMap;
	}

	// --- Form ---

	createInputForm() {
		const form = this.containerEl.createEl("form", {
			cls: "df-input-form",
		});

		this.timeInputEl = form.createEl("input", {
			type: "time",
		}) as HTMLInputElement;
		this.timeInputEl.addClass("df-input-time");

		this.textInputEl = form.createEl("input", {
			type: "text",
			placeholder: "Событие...",
		}) as HTMLInputElement;
		this.textInputEl.addClass("df-input-text");
		this.attachSuggestHandlers(this.textInputEl);

		// Key Selector
		const keySelector = document.createElement("div");
		keySelector.className = "df-key-selector";

		const ksButton = document.createElement("button");
		ksButton.type = "button";
		ksButton.className = "ks-button";

		const options = this.plugin.settings.logKeys.map((k) => ({
			key: this.normalizeKey(k.key),
			icon: k.iconSvg || "",
		}));
		let selectedKey = options[0] ? options[0].key : "";

		const updateKsButton = () => {
			const found = options.find((o) => o.key === selectedKey);
			if (found) {
				ksButton.innerHTML = found.icon
					? found.icon
					: this.escapeHtml(found.key.charAt(0));
				ksButton.title = found.key;
			}
		};
		updateKsButton();

		const ksDropdown = document.createElement("ul");
		ksDropdown.className = "ks-dropdown";
		ksDropdown.style.position = "fixed";
		ksDropdown.style.zIndex = "10060";

		options.forEach((opt) => {
			const li = document.createElement("li");
			li.className = "ks-option";
			li.innerHTML = `${opt.icon} ${this.escapeHtml(opt.key)}`;
			li.onclick = (e) => {
				e.preventDefault();
				selectedKey = opt.key;
				updateKsButton();
				try {
					ksDropdown.remove();
				} catch (e) {}
			};
			ksDropdown.appendChild(li);
		});

		ksButton.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = ksButton.getBoundingClientRect();
			ksDropdown.style.top = `${rect.bottom + 5}px`;
			ksDropdown.style.left = `${rect.left}px`;
			document.body.appendChild(ksDropdown);
			const close = () => {
				try {
					ksDropdown.remove();
				} catch (e) {}
				document.removeEventListener("click", close);
			};
			document.addEventListener("click", close);
		};

		keySelector.appendChild(ksButton);
		form.appendChild(keySelector);

		form.onsubmit = async (e) => {
			e.preventDefault();
			const prefix = selectedKey;
			const timeVal = this.timeInputEl!.value;
			const textVal = this.textInputEl!.value;

			this.textInputEl!.value = "";
			this.timeInputEl!.value = "";

			await this.addEntry(prefix, timeVal, textVal);
			this.textInputEl!.focus();
		};
	}

	createDateNavigationBlock() {
		const dateBlock = this.containerEl.createEl("div", {
			cls: "df-date-block",
		});

		this.dateInputEl = dateBlock.createEl("input", {
			type: "date",
			cls: "df-date-input",
		}) as HTMLInputElement;
		this.dateInputEl.value =
			this.currentDate || moment().format("YYYY-MM-DD");
		this.dateInputEl.onchange = () => {
			this.currentDate = this.dateInputEl!.value;
			this.refreshData();
		};

		// Prev
		const prevBtn = dateBlock.createEl("button", {
			text: "←",
			cls: "df-nav-btn",
		});
		prevBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.subtract(1, "day")
				.format("YYYY-MM-DD");
			if (this.dateInputEl) this.dateInputEl.value = this.currentDate;
			this.refreshData();
		};

		// [ИСПРАВЛЕНИЕ] Кнопка "Сегодня"
		this.todayBtnEl = dateBlock.createEl("button", {
			text: "Сегодня",
			cls: "df-nav-btn",
		});
		this.todayBtnEl.style.fontSize = "10px";
		// Начальное состояние будет установлено в refreshData
		this.todayBtnEl.onclick = () => {
			this.currentDate = moment().format("YYYY-MM-DD");
			if (this.dateInputEl) this.dateInputEl.value = this.currentDate;
			this.refreshData();
		};

		// Next
		const nextBtn = dateBlock.createEl("button", {
			text: "→",
			cls: "df-nav-btn",
		});
		nextBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.add(1, "day")
				.format("YYYY-MM-DD");
			if (this.dateInputEl) this.dateInputEl.value = this.currentDate;
			this.refreshData();
		};

		const rightControls = dateBlock.createEl("div", {
			cls: "df-date-right-controls",
		});

		// NOW Button
		const nowBtn = rightControls.createEl("button", {
			text: "Сейчас",
			cls: "df-nav-btn df-now-btn",
		});
		nowBtn.onclick = async (e) => {
			e.preventDefault();
			const prefix =
				(this.containerEl.querySelector(".ks-button") as HTMLElement)
					?.title || "";
			const now = moment().format("HH:mm");
			const txt = this.textInputEl!.value;
			this.textInputEl!.value = "";
			await this.addEntryNoRecorded(prefix, now, txt);
		};

		// Add Button
		const addBtn = rightControls.createEl("button", {
			text: "Добавить",
			cls: "df-nav-btn df-add-btn",
		});
		addBtn.onclick = (e) => {
			e.preventDefault();
			this.containerEl
				.querySelector("form.df-input-form")
				?.dispatchEvent(new Event("submit"));
		};
	}

	// ---------- Actions & Utils ----------

	async updateFrontmatter(file: TFile, key: string, value: any) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}

	// --- Custom confirmation dialog (replaces native confirm) ---
	async showConfirmDialog(message: string): Promise<boolean> {
		const el = document.createElement("div");
		el.className = "df-confirm-overlay";
		// make it cover container area — attach to containerEl so styles inherit
		el.style.position = "absolute";
		el.style.left = "0";
		el.style.right = "0";
		el.style.top = "0";
		el.style.bottom = "0";
		el.style.display = "flex";
		el.style.alignItems = "center";
		el.style.justifyContent = "center";
		el.style.zIndex = "10000";
		el.style.pointerEvents = "auto";

		const box = document.createElement("div");
		box.style.background = "var(--background-primary)";
		box.style.borderRadius = "8px";
		box.style.padding = "12px";
		box.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
		box.style.minWidth = "260px";
		box.style.textAlign = "center";

		const txt = document.createElement("div");
		txt.textContent = message;
		txt.style.marginBottom = "12px";
		box.appendChild(txt);

		const actions = document.createElement("div");
		actions.style.display = "flex";
		actions.style.justifyContent = "center";
		actions.style.gap = "10px";

		const no = document.createElement("button");
		no.className = "df-nav-btn";
		no.textContent = "Отмена";

		const yes = document.createElement("button");
		yes.className = "df-nav-btn";
		yes.textContent = "Удалить";

		actions.appendChild(no);
		actions.appendChild(yes);
		box.appendChild(actions);
		el.appendChild(box);

		this.containerEl.appendChild(el);

		return await new Promise<boolean>((resolve) => {
			const cleanup = () => {
				try {
					el.remove();
				} catch {}
			};
			yes.addEventListener(
				"click",
				() => {
					cleanup();
					resolve(true);
				},
				{ once: true }
			);
			no.addEventListener(
				"click",
				() => {
					cleanup();
					resolve(false);
				},
				{ once: true }
			);
		});
	}

	parseEventLine(line: string, idx: number): EventModel | null {
		const anchoredRe = /^(.+?)::\s*(.*)$/;
		let m = line.match(anchoredRe);
		let keyRaw: string | null = null;
		let rawBody = "";

		if (m) {
			keyRaw = m[1].trim();
			rawBody = (m[2] || "").trim();
		} else {
			const pos = line.indexOf("::");
			if (pos === -1) return null;
			const left = line.slice(0, pos).trim();
			const right = line.slice(pos + 2).trim();
			if (!left) return null;
			const leftTokens = left.split(/\s+/);
			keyRaw = leftTokens[leftTokens.length - 1] || null;
			if (!keyRaw) return null;
			rawBody = right;
		}

		const key = keyRaw ? this.normalizeKey(keyRaw) : "";
		let entryTime: string | null = null;
		let recordedTime: string | null = null;
		let text = rawBody;

		const trailing = text.match(/\s*\((\d{1,2}:\d{2})\)\s*$/);
		if (trailing) {
			recordedTime = trailing[1];
			text = text.substring(0, trailing.index).trim();
		}

		const leading = text.match(
			/^(?:\(?\s*(\d{1,2}:\d{2})\s*\)?)(?:[\-\.\s]+)?(.*)$/
		);
		if (leading) {
			entryTime = leading[1];
			text = (leading[2] || "").trim();
		}

		return {
			idx,
			raw: line,
			key,
			body: rawBody,
			entryTime,
			recordedTime,
			text,
		};
	}

	attachSuggestHandlers(inputEl: HTMLInputElement) {
		if (!inputEl) return;

		// gather tags and markdown files
		const tagsObj: Record<string, any> = (this.app.metadataCache as any)
			.getTags
			? (this.app.metadataCache as any).getTags()
			: {};
		const allTags = Object.keys(tagsObj || {}).map((t) =>
			t.replace(/^#/, "")
		);
		const mdFiles: TFile[] = (this.app.vault as any).getMarkdownFiles
			? (this.app.vault as any).getMarkdownFiles()
			: (this.app.vault as any)
					.getFiles()
					.filter((f: any) => f.path && f.path.endsWith(".md"));

		// helper: replace substring [start,end) with insertion and place caret after insertion
		const replaceRange = (
			start: number,
			end: number,
			insertion: string
		) => {
			const val = inputEl.value;
			const before = val.slice(0, start);
			const after = val.slice(end);
			inputEl.value = before + insertion + after;
			const pos = before.length + insertion.length;
			inputEl.setSelectionRange(pos, pos);
			inputEl.focus();
		};

		// dropdown element common for both tags and files
		let dropdownEl: HTMLUListElement | null = null;
		let currentItems: { type: "tag" | "file"; value: string | TFile }[] =
			[];

		let _docClickHandler: ((ev: Event) => void) | null = null;

		const closeDropdown = () => {
			// remove dropdown DOM
			if (dropdownEl) {
				try {
					dropdownEl.remove();
				} catch {}
				dropdownEl = null;
				currentItems = [];
			}
			// remove doc click handler if set
			if (_docClickHandler) {
				try {
					document.removeEventListener("click", _docClickHandler);
				} catch {}
				_docClickHandler = null;
			}
			// remove other handlers
			try {
				document.removeEventListener("keydown", onDocKey);
			} catch {}
			try {
				window.removeEventListener("resize", positionDropdown);
			} catch {}
		};

		const positionDropdown = () => {
			if (!dropdownEl) return;
			try {
				const rect = inputEl.getBoundingClientRect();
				const left = Math.max(8, rect.left);
				const top = rect.bottom + 6;
				const width = Math.max(rect.width, 140);
				dropdownEl.style.left = `${left}px`;
				dropdownEl.style.top = `${top}px`;
				dropdownEl.style.minWidth = `${width}px`;
			} catch {
				// ignore
			}
		};

		// keyboard handling while dropdown open (Esc to close, Enter to choose first)
		const onDocKey = (e: KeyboardEvent) => {
			if (!dropdownEl) return;
			if (e.key === "Escape") {
				closeDropdown();
				e.preventDefault();
			} else if (e.key === "Enter") {
				// choose first item
				const first = currentItems[0];
				if (first) {
					if (first.type === "tag") {
						const tag = first.value as string;
						const caret =
							inputEl.selectionStart ?? inputEl.value.length;
						const prefix = inputEl.value.slice(0, caret);
						const lastHash = prefix.lastIndexOf("#");
						const tokenStart = lastHash >= 0 ? lastHash : caret;
						const tokenEnd = caret;
						replaceRange(tokenStart, tokenEnd, `#${tag} `);
					} else {
						const f = first.value as TFile;
						const caret =
							inputEl.selectionStart ?? inputEl.value.length;
						const prefix = inputEl.value.slice(0, caret);
						const lastBr = prefix.lastIndexOf("[[");
						const tokenStart = lastBr >= 0 ? lastBr : caret;
						const tokenEnd = caret;
						replaceRange(
							tokenStart,
							tokenEnd,
							`[[${f.path}|${f.basename}]] `
						);
					}
					closeDropdown();
					e.preventDefault();
				}
			}
		};

		const renderDropdown = (
			items: { type: "tag" | "file"; value: string | TFile }[]
		) => {
			// close existing
			closeDropdown();

			dropdownEl = document.createElement("ul");
			dropdownEl.className = "ks-dropdown";
			dropdownEl.style.position = "fixed";
			dropdownEl.style.zIndex = "10060";
			dropdownEl.style.boxSizing = "border-box";
			dropdownEl.style.maxHeight = "40vh";
			dropdownEl.style.overflow = "auto";
			dropdownEl.style.padding = "6px 0";
			dropdownEl.style.margin = "0";
			dropdownEl.style.background = "var(--background-primary)";
			dropdownEl.style.border =
				"1px solid var(--background-modifier-border)";
			dropdownEl.style.borderRadius = "6px";
			dropdownEl.style.boxShadow = "0 8px 20px rgba(0,0,0,0.06)";

			currentItems = items;

			if (items.length === 0) {
				const li = document.createElement("li");
				li.className = "ks-option";
				li.style.padding = "6px 10px";
				li.style.opacity = "0.6";
				li.textContent = "Нет совпадений";
				dropdownEl.appendChild(li);
			} else {
				items.forEach((it) => {
					const li = document.createElement("li");
					li.className = "ks-option";
					li.style.padding = "6px 10px";
					li.style.cursor = "pointer";
					li.style.whiteSpace = "nowrap";
					if (it.type === "tag") {
						li.innerHTML = this.escapeHtml(
							`#${it.value as string}`
						);
						li.onclick = (ev) => {
							ev.preventDefault();
							// insert: find last '#' before caret
							const caret =
								inputEl.selectionStart ?? inputEl.value.length;
							const prefix = inputEl.value.slice(0, caret);
							const lastHash = prefix.lastIndexOf("#");
							const tokenStart = lastHash >= 0 ? lastHash : caret;
							const tokenEnd = caret;
							replaceRange(
								tokenStart,
								tokenEnd,
								`#${String(it.value)} `
							);
							closeDropdown();
						};
					} else {
						const f = it.value as TFile;
						li.innerHTML = this.escapeHtml(f.basename || f.path);
						li.onclick = (ev) => {
							ev.preventDefault();
							const caret =
								inputEl.selectionStart ?? inputEl.value.length;
							const prefix = inputEl.value.slice(0, caret);
							const lastBr = prefix.lastIndexOf("[[");
							const tokenStart = lastBr >= 0 ? lastBr : caret;
							const tokenEnd = caret;
							replaceRange(
								tokenStart,
								tokenEnd,
								`[[${f.path}|${f.basename}]] `
							);
							closeDropdown();
						};
					}
					dropdownEl!.appendChild(li);
				});
			}

			document.body.appendChild(dropdownEl);
			positionDropdown();
			document.addEventListener("keydown", onDocKey);
			window.addEventListener("resize", positionDropdown);
			// close on click outside (keep handler reference so we can remove it later)
			_docClickHandler = (ev: Event) => {
				const t = (ev.target as Node) || null;
				// defensive guards
				if (!dropdownEl) return;
				if (!t) return;
				// if click outside dropdown and not on the input, close
				if (!dropdownEl.contains(t) && t !== inputEl) {
					closeDropdown();
				}
			};
			// attach handler (use timeout to allow input to update caret before click capture)
			setTimeout(() => {
				if (_docClickHandler)
					document.addEventListener("click", _docClickHandler!);
			}, 0);
		};

		// live filter helpers
		const showTagSuggestions = (filter: string) => {
			const q = (filter || "").toLowerCase();
			const items = allTags
				.map((t) => ({ type: "tag" as const, value: t }))
				.filter((it) =>
					`#${it.value as string}`.toLowerCase().includes(q)
				);
			renderDropdown(items);
		};
		const showFileSuggestions = (filter: string) => {
			const q = (filter || "").toLowerCase();
			const items = (mdFiles || [])
				.map((f) => ({ type: "file" as const, value: f }))
				.filter((it) =>
					this.escapeHtml(
						(it.value as TFile).basename || (it.value as TFile).path
					)
						.toLowerCase()
						.includes(q)
				);
			renderDropdown(items);
		};

		// open dropdown when user types '#' or when they type second '['
		inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "#") {
				// open after character inserted to get correct caret/val
				setTimeout(() => {
					const caret =
						inputEl.selectionStart ?? inputEl.value.length;
					const prefixPart = inputEl.value.slice(0, caret);
					const lastToken = prefixPart.split(/\s/).pop() || "";
					showTagSuggestions(lastToken);
				}, 0);
			} else if (e.key === "[") {
				// open on second '['
				setTimeout(() => {
					const caret =
						inputEl.selectionStart ?? inputEl.value.length;
					if (caret >= 1 && inputEl.value[caret - 1] === "[") {
						// open file suggest with current token after [[
						const token =
							inputEl.value.slice(0, caret).split(/\s/).pop() ||
							"";
						showFileSuggestions(token.replace(/\[\[*$/, ""));
					}
				}, 0);
			} else if (e.key === "Escape") {
				closeDropdown();
			}
		});

		// also update suggestions while typing (useful after opening)
		inputEl.addEventListener("input", () => {
			if (!dropdownEl) return;
			// determine context: if there is a '#' immediately before caret in current token -> filter tags
			const caret = inputEl.selectionStart ?? inputEl.value.length;
			const prefixPart = inputEl.value.slice(0, caret);
			const lastToken = prefixPart.split(/\s/).pop() || "";
			if (lastToken.startsWith("#")) {
				showTagSuggestions(lastToken);
			} else if (lastToken.includes("[[")) {
				// filter files
				const afterBr = lastToken.split("[[").pop() || "";
				showFileSuggestions(afterBr);
			} else {
				closeDropdown();
			}
		});
	}

	parseInlineMarkup(text: string): DocumentFragment {
		const frag = document.createDocumentFragment();
		if (!text) return frag;
		const pattern = /(\[\[[^\]]+\]\]|#[\w\u0400-\u04FF\-]+|\d{1,2}:\d{2})/g;
		let lastIdx = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			if (m.index > lastIdx) {
				frag.appendChild(
					document.createTextNode(text.slice(lastIdx, m.index))
				);
			}
			const token = m[0];
			if (token.startsWith("[[")) {
				const inner = token.slice(2, -2);
				const parts = inner.split("|");
				const linkpath = parts[0].trim();
				const alias = (parts[1] || parts[0]).trim();
				const a = document.createElement("a");
				a.className = "internal-link";
				a.setAttribute("data-href", linkpath);
				a.textContent = alias;
				frag.appendChild(a);
			} else if (token.startsWith("#")) {
				const tag = token.slice(1);
				const a = document.createElement("a");
				a.className = "tag";
				a.setAttribute("href", `#${tag}`);
				a.textContent = `#${tag}`;
				a.setAttribute("data-tag", tag);
				frag.appendChild(a);
			} else if (/^\d{1,2}:\d{2}$/.test(token)) {
				const span = document.createElement("span");
				span.className = "df-time-inline";
				span.textContent = token;
				frag.appendChild(span);
			} else {
				frag.appendChild(document.createTextNode(token));
			}
			lastIdx = pattern.lastIndex;
		}
		if (lastIdx < text.length)
			frag.appendChild(document.createTextNode(text.slice(lastIdx)));
		return frag;
	}

	async addEntry(prefix: string, time: string, text: string) {
		if (!text.trim()) {
			new Notice("Текст события не может быть пустым.");
			this.textInputEl!.focus();
			return;
		}
		const file = await this.getFileOrNull();
		if (!file) return;

		// --- Расширенный матч тегов: поддержка "кофе", "#кофе", "кофе,foo" и нечувствительность к регистру ---
		const tagMatch = text.match(/#([^\s#]+)/);
		if (tagMatch) {
			const tag = tagMatch[1];
			const tagLower = tag.toLowerCase();

			const mapped = this.plugin.settings.logKeys.find((k: any) => {
				if (!k || !k.tags) return false;
				// unify tags value into array of clean tag strings
				let raw = k.tags;
				let list: string[] = [];
				if (Array.isArray(raw)) {
					list = raw.map((t: any) =>
						String(t || "")
							.replace(/^#/, "")
							.trim()
					);
				} else {
					// allow comma/semicolon separated values, or single token
					list = String(raw)
						.split(/[,;]+/)
						.map((s) => s.replace(/^#/, "").trim())
						.filter(Boolean);
				}
				// compare lowercased
				return list.some((t) => t.toLowerCase() === tagLower);
			});

			if (mapped) {
				prefix = this.normalizeKey(mapped.key);
				// remove all occurrences of the tag token (#tag) from the text (word boundary)
				const esc = this.escapeRegExp(tag);
				const tagRe = new RegExp(`#${esc}(?=$|\\s|[.,;:!?])`, "giu");
				text = text
					.replace(tagRe, "")
					.replace(/\s{2,}/g, " ")
					.trim();
			}
		}

		const entryTime = time ? time : "";
		const recordedTime = moment().format("HH:mm");
		const line = `${prefix}:: ${entryTime}${
			entryTime ? " " : ""
		}${text.trim()} (${recordedTime})`.trim();

		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async addEntryNoRecorded(prefix: string, time: string, text: string) {
		if (!text.trim()) {
			new Notice("Текст события не может быть пустым.");
			this.textInputEl!.focus();
			return;
		}
		const file = await this.getFileOrNull();
		if (!file) return;

		// --- Расширенный матч тегов: поддержка "кофе", "#кофе", "кофе,foo" и нечувствительность к регистру ---
		const tagMatch = text.match(/#([^\s#]+)/);
		if (tagMatch) {
			const tag = tagMatch[1];
			const tagLower = tag.toLowerCase();

			const mapped = this.plugin.settings.logKeys.find((k: any) => {
				if (!k || !k.tags) return false;
				// unify tags value into array of clean tag strings
				let raw = k.tags;
				let list: string[] = [];
				if (Array.isArray(raw)) {
					list = raw.map((t: any) =>
						String(t || "")
							.replace(/^#/, "")
							.trim()
					);
				} else {
					// allow comma/semicolon separated values, or single token
					list = String(raw)
						.split(/[,;]+/)
						.map((s) => s.replace(/^#/, "").trim())
						.filter(Boolean);
				}
				// compare lowercased
				return list.some((t) => t.toLowerCase() === tagLower);
			});

			if (mapped) {
				prefix = this.normalizeKey(mapped.key);
				// remove all occurrences of the tag token (#tag) from the text (word boundary)
				const esc = this.escapeRegExp(tag);
				const tagRe = new RegExp(`#${esc}(?=$|\\s|[.,;:!?])`, "giu");
				text = text
					.replace(tagRe, "")
					.replace(/\s{2,}/g, " ")
					.trim();
			}
		}

		const entryTime = time ? time : "";
		const line = `${prefix}:: ${entryTime}${
			entryTime ? " " : ""
		}${text.trim()}`.trim();
		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async updateEventLine(file: TFile, lineIdx: number, newLine: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines[lineIdx] = newLine;
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async removeEventLine(file: TFile, lineIdx: number) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		if (lineIdx < 0 || lineIdx >= lines.length) return;
		lines.splice(lineIdx, 1);
		await this.app.vault.modify(file, lines.join("\n"));
	}

	async reorderEventLines(
		file: TFile,
		srcLineIdx: number,
		destLineIdx: number
	) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const eventRe = /^(.+?)::\s*(.*)$/;
		const eventIndices: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (eventRe.test(lines[i].trim())) eventIndices.push(i);
		}
		const srcPos = eventIndices.indexOf(srcLineIdx);
		const destPos = eventIndices.indexOf(destLineIdx);
		if (srcPos === -1 || destPos === -1) return;

		const newOrder = [...eventIndices];
		const [moved] = newOrder.splice(srcPos, 1);
		newOrder.splice(destPos, 0, moved);

		const newEventLines = newOrder.map((i) => lines[i]);
		const out = [...lines];
		for (let k = 0; k < eventIndices.length; k++) {
			out[eventIndices[k]] = newEventLines[k];
		}
		await this.app.vault.modify(file, out.join("\n"));
	}

	// ---------- RENDER EVENT CARD ----------
	renderEventCard(
		ev: EventModel,
		iconMap: Record<string, string>,
		posIndex: number,
		file: TFile,
		isReadOnly: boolean // <-- Флаг только для чтения
	) {
		const li = document.createElement("li");
		li.className = "df-event-card";
		li.setAttribute("data-file-line-idx", String(ev.idx));
		li.setAttribute("data-event-pos", String(posIndex));
		if (isReadOnly) li.addClass("df-readonly-card");

		// Left
		const leftWrap = document.createElement("div");
		leftWrap.className = "df-event-left";
		leftWrap.style.position = "relative";

		// Drag Handle (Только если не ReadOnly)
		if (!isReadOnly) {
			const handle = document.createElement("span");
			handle.className = "df-drag-handle";
			handle.textContent = "⋮";
			handle.setAttribute("draggable", "true");

			// D&D Handlers
			handle.addEventListener("dragstart", (e) => {
				e.dataTransfer!.setData("text/plain", String(ev.idx));
				li.classList.add("is-dragging");
			});

			// Остальные D&D вешаем на LI ниже
			leftWrap.appendChild(handle);
		}

		const textDiv = document.createElement("div");
		textDiv.className = "df-event-text";

		let bodyWithoutRecorded = ev.body || "";
		bodyWithoutRecorded = bodyWithoutRecorded
			.replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, "")
			.trim();

		textDiv.innerHTML = "";
		const frag = this.parseInlineMarkup(bodyWithoutRecorded);
		textDiv.appendChild(frag);
		textDiv.style.display = "inline-block";
		leftWrap.appendChild(textDiv);
		li.appendChild(leftWrap);

		// Right: meta
		const rightDiv = document.createElement("div");
		rightDiv.className = "df-event-meta";
		rightDiv.style.marginLeft = "auto";

		const metaGroup = document.createElement("div");
		metaGroup.className = "df-meta-group";

		if (ev.recordedTime) {
			const rec = document.createElement("span");
			rec.className = "df-recorded-time";
			rec.textContent = this.escapeHtml(ev.recordedTime);
			metaGroup.appendChild(rec);
		}

		if (ev.key !== "dl") {
			const badge = document.createElement("div");
			badge.className = "df-key-badge";
			const icon = iconMap[ev.key] || "";
			if (icon) {
				const spanI = document.createElement("span");
				spanI.className = "df-key-icon";
				spanI.innerHTML = icon;
				badge.appendChild(spanI);
			}
			const spanKey = document.createElement("span");
			spanKey.textContent = ev.key;
			badge.appendChild(spanKey);
			metaGroup.appendChild(badge);
		}

		rightDiv.appendChild(metaGroup);

		// Controls (Только если не ReadOnly)
		if (!isReadOnly) {
			const controls = document.createElement("div");
			controls.className = "df-event-controls";
			const editBtn = document.createElement("button");
			editBtn.className = "df-control-btn df-edit-btn";
			editBtn.innerHTML = this.plugin.settings.icons?.hoverEdit || "✎";
			controls.appendChild(editBtn);
			rightDiv.appendChild(controls);

			editBtn.onclick = () => {
				this.openEditOverlay(li, file, ev);
			};

			// Drop handlers
			li.addEventListener("dragend", () => {
				li.classList.remove("is-dragging");
				this.containerEl
					.querySelectorAll(".drag-over")
					.forEach((el) => el.classList.remove("drag-over"));
			});
			li.addEventListener("dragover", (e) => {
				e.preventDefault();
				li.classList.add("drag-over");
			});
			li.addEventListener("dragleave", () =>
				li.classList.remove("drag-over")
			);
			li.addEventListener("drop", async (e) => {
				e.preventDefault();
				li.classList.remove("drag-over");
				const srcIdxStr = e.dataTransfer!.getData("text/plain");
				const srcLineIdx = Number(srcIdxStr);
				const dstLineIdx = ev.idx;
				if (isNaN(srcLineIdx) || srcLineIdx === dstLineIdx) return;
				await this.reorderEventLines(file, srcLineIdx, dstLineIdx);
			});
		}

		li.appendChild(rightDiv);
		return li;
	}

	closeEditOverlay() {
		if (this.editOverlayEl) {
			this.editOverlayEl.remove();
			this.editOverlayEl = null;
		}
		const els = this.containerEl.querySelectorAll(".df-editing-hidden");
		els.forEach((el) => el.classList.remove("df-editing-hidden"));
	}

	openEditOverlay(li: HTMLElement, file: TFile, ev: EventModel) {
		this.closeEditOverlay();
		li.classList.add("df-editing-hidden");

		const overlay = document.createElement("div");
		overlay.className = "df-edit-overlay";
		overlay.style.position = "absolute";
		overlay.style.boxSizing = "border-box";
		overlay.style.zIndex = "9999";
		overlay.style.width = "100%";
		overlay.style.background = "var(--background-primary)";
		overlay.style.borderRadius = "6px";
		overlay.style.border = "1px solid var(--interactive-accent)";

		const form = document.createElement("div");
		form.className = "df-input-form";
		form.style.margin = "0";
		form.style.borderTop = "none";

		const timeInp = document.createElement("input");
		timeInp.type = "time";
		timeInp.className = "df-input-time";
		(timeInp as HTMLInputElement).value = ev.entryTime || "";

		const textInp = document.createElement("input");
		textInp.type = "text";
		textInp.className = "df-input-text";
		(textInp as HTMLInputElement).value = ev.text || "";
		this.attachSuggestHandlers(textInp as HTMLInputElement);

		const keySelector = document.createElement("div");
		keySelector.className = "df-key-selector";
		const ksButton = document.createElement("button");
		ksButton.type = "button";
		ksButton.className = "ks-button";

		const options: { key: string; icon: string }[] = [];
		this.plugin.settings.logKeys.forEach((k) => {
			const norm = this.normalizeKey(k.key);
			options.push({ key: norm, icon: k.iconSvg || "" });
		});
		if (ev.key && !options.find((o) => o.key === ev.key))
			options.unshift({ key: ev.key, icon: "" });

		let selectedKey = ev.key || (options[0] && options[0].key) || "";

		const updateKsButton = () => {
			const found = options.find((o) => o.key === selectedKey);
			if (found) {
				ksButton.innerHTML = found.icon
					? found.icon
					: this.escapeHtml(found.key.charAt(0));
			}
		};
		updateKsButton();

		const ksDropdown = document.createElement("ul");
		ksDropdown.className = "ks-dropdown";
		ksDropdown.style.position = "fixed";
		ksDropdown.style.zIndex = "10060";

		options.forEach((opt) => {
			const liOpt = document.createElement("li");
			liOpt.className = "ks-option";
			liOpt.innerHTML = `${opt.icon} ${this.escapeHtml(opt.key)}`;
			liOpt.onclick = (e) => {
				e.preventDefault();
				selectedKey = opt.key;
				updateKsButton();
				try {
					ksDropdown.remove();
				} catch (e) {}
			};
			ksDropdown.appendChild(liOpt);
		});

		ksButton.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = ksButton.getBoundingClientRect();
			ksDropdown.style.top = `${rect.bottom + 5}px`;
			ksDropdown.style.left = `${rect.left}px`;
			document.body.appendChild(ksDropdown);
			const close = () => {
				try {
					ksDropdown.remove();
				} catch (e) {}
				document.removeEventListener("click", close);
			};
			document.addEventListener("click", close);
		};
		keySelector.appendChild(ksButton);

		const actionsWrap = document.createElement("div");
		actionsWrap.className = "df-edit-actions";

		const makeActionBtn = (
			svgInner: string,
			title: string,
			cls: string = ""
		) => {
			const btn = document.createElement("div");
			btn.className = `df-action-btn ${cls}`;
			btn.title = title;
			btn.innerHTML = svgInner;
			return btn;
		};

		const svgSave = this.plugin.settings.icons?.edit || "S";
		const svgCancel = this.plugin.settings.icons?.cancel || "C";
		const svgDelete = this.plugin.settings.icons?.trash || "D";

		const saveBtn = makeActionBtn(svgSave, "Сохранить", "save");
		const cancelBtn = makeActionBtn(svgCancel, "Отмена", "cancel");
		const deleteBtn = makeActionBtn(svgDelete, "Удалить", "delete");

		actionsWrap.appendChild(saveBtn);
		actionsWrap.appendChild(cancelBtn);
		actionsWrap.appendChild(deleteBtn);

		form.appendChild(timeInp);
		form.appendChild(textInp);
		form.appendChild(keySelector);
		form.appendChild(actionsWrap);
		overlay.appendChild(form);

		if (this.logListContainer) {
			this.logListContainer.appendChild(overlay);
		} else {
			this.containerEl.appendChild(overlay);
		}

		const positionOverlay = () => {
			try {
				const top = li.offsetTop;
				const left = li.offsetLeft;
				const width = li.clientWidth;
				overlay.style.top = `${top}px`;
				overlay.style.left = `${left}px`;
				overlay.style.width = `${width}px`;
			} catch {}
		};
		positionOverlay();

		saveBtn.onclick = async (e) => {
			e.preventDefault();
			const prefix = selectedKey;
			const t = (timeInp as HTMLInputElement).value;
			const txt = (textInp as HTMLInputElement).value.trim();
			const entryTime = t ? t : "";
			const recordedPart = ev.recordedTime ? ` (${ev.recordedTime})` : "";
			const newLine = `${prefix}:: ${entryTime}${
				entryTime ? " " : ""
			}${txt}${recordedPart}`.trim();

			await this.updateEventLine(file, ev.idx, newLine);
			this.closeEditOverlay();
		};

		cancelBtn.onclick = (e) => {
			e.preventDefault();
			this.closeEditOverlay();
		};

		deleteBtn.onclick = async (e) => {
			e.preventDefault();
			const ok = await this.showConfirmDialog("Удалить это событие?");
			if (!ok) return;
			await this.removeEventLine(file, ev.idx);
			this.closeEditOverlay();
			// trigger refresh after deletion (debounced watcher may also refresh it)
			this.triggerRefresh();
		};

		setTimeout(() => (textInp as HTMLInputElement).focus(), 50);
		this.editOverlayEl = overlay;
	}
}
