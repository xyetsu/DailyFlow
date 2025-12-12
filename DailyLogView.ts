import { ItemView, WorkspaceLeaf, TFile, moment } from "obsidian";
import DailyLogPlugin from "./main";

export const VIEW_TYPE_DAILY_LOG = "daily-log-view";

export class DailyLogView extends ItemView {
	plugin: DailyLogPlugin;
	currentDate: string;
	container: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: DailyLogPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentDate = moment().format("YYYY-MM-DD");
	}

	getViewType() {
		return VIEW_TYPE_DAILY_LOG;
	}
	getDisplayText() {
		return "Daily Flow";
	}
	getIcon() {
		return "calendar-days";
	}

	async onOpen() {
		this.container = this.contentEl;
		this.container.addClass("df-container"); // NEW CLASS
		await this.render();

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path === this.getFilePath()) this.render();
			})
		);
	}

	getFolder() {
		return `Журнал/Ежедневные/${this.currentDate.slice(
			0,
			4
		)}/${this.currentDate.slice(5, 7)}`;
	}
	getFilePath() {
		return `${this.getFolder()}/${this.currentDate}.md`;
	}

	async getFileOrNull(): Promise<TFile | null> {
		return this.app.vault.getAbstractFileByPath(
			this.getFilePath()
		) as TFile;
	}

	async render() {
		this.container.empty();
		this.renderHeader();

		const file = await this.getFileOrNull();
		if (!file) {
			const msgDiv = this.container.createEl("div", {
				cls: "df-msg-empty",
			}); // NEW CLASS
			msgDiv.createEl("div", {
				text: `Заметка ${this.currentDate} не найдена.`,
			});
			const btn = msgDiv.createEl("button", {
				text: "Создать заметку",
				attr: { style: "margin-top: 8px;" },
			});
			btn.onclick = async () => {
				await this.createDailyNote();
				await this.render();
			};
			return;
		}

		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);

		this.renderHabits(file, cache?.frontmatter);
		this.container.createEl("hr");
		this.renderLogList(content);
		this.renderInputForm();
	}

	renderHeader() {
		const header = this.container.createEl("div", { cls: "df-header" }); // NEW CLASS

		const navGroup = header.createEl("div", { cls: "df-nav-group" }); // NEW CLASS
		const prevBtn = navGroup.createEl("button", {
			text: "←",
			cls: "df-nav-btn",
		}); // NEW CLASS
		prevBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.subtract(1, "day")
				.format("YYYY-MM-DD");
			this.render();
		};

		navGroup.createEl("span", {
			text: this.currentDate,
			cls: "df-date-title",
		}); // NEW CLASS

		const nextBtn = navGroup.createEl("button", {
			text: "→",
			cls: "df-nav-btn",
		}); // NEW CLASS
		nextBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.add(1, "day")
				.format("YYYY-MM-DD");
			this.render();
		};

		const today = moment().format("YYYY-MM-DD");
		if (this.currentDate !== today) {
			const todayBtn = header.createEl("button", {
				text: "Сегодня",
				cls: "df-today-btn",
			}); // NEW CLASS
			todayBtn.onclick = () => {
				this.currentDate = today;
				this.render();
			};
		}
	}

	renderHabits(file: TFile, frontmatter: any) {
		const habitsDiv = this.container.createEl("div", {
			cls: "df-habits-list",
		}); // NEW CLASS

		this.plugin.settings.habits.forEach((habit) => {
			const row = habitsDiv.createEl("div", { cls: "df-habit-row" }); // NEW CLASS

			const left = row.createEl("div", { cls: "df-habit-label" }); // NEW CLASS
			left.innerHTML = `<span class="df-habit-icon">${habit.iconSvg}</span> <span>${habit.key}</span>`; // NEW CLASS

			const val = frontmatter ? frontmatter[habit.key] : null;

			if (habit.type === "checkbox") {
				const cb = row.createEl("input", { type: "checkbox" });
				cb.addClass("df-habit-checkbox"); // NEW CLASS
				cb.checked = val === true;
				cb.onchange = async () =>
					await this.updateFrontmatter(file, habit.key, cb.checked);
			} else {
				const inp = row.createEl("input", {
					type: habit.type === "number" ? "number" : "text",
				});
				inp.addClass("df-habit-input"); // NEW CLASS
				inp.value = val !== undefined ? val : "";
				inp.onblur = async () => {
					if (inp.value != val) {
						const saveVal =
							habit.type === "number"
								? Number(inp.value)
								: inp.value;
						await this.updateFrontmatter(file, habit.key, saveVal);
					}
				};
			}
		});
	}

	async updateFrontmatter(file: TFile, key: string, value: any) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}

	renderLogList(content: string) {
		const logContainer = this.container.createEl("ul", {
			cls: "df-log-list",
		}); // NEW CLASS
		const lines = content.split("\n");

		const iconMap: Record<string, string> = {};
		this.plugin.settings.logKeys.forEach((k) => {
			iconMap[k.key.replace("::", "")] = k.iconSvg;
		});

		lines.forEach((line) => {
			line = line.trim();
			const match = line.match(/^(.+?)::\s*(.*)$/);

			if (match) {
				const key = match[1].trim();
				const textRaw = match[2];

				const timeMatch = textRaw.match(/\s*\((\d{2}:\d{2})\)$/);
				const cleanText = timeMatch
					? textRaw.substring(0, timeMatch.index).trim()
					: textRaw;
				const time = timeMatch ? timeMatch[1] : "";

				// NEW CLASSES FOR EVENT CARD
				const li = logContainer.createEl("li", {
					cls: "df-event-card",
				});

				// Left: Text
				li.createEl("div", { text: cleanText, cls: "df-event-text" });

				// Right: Meta Container
				const rightDiv = li.createEl("div", { cls: "df-event-meta" });

				if (time) {
					rightDiv.createEl("span", {
						text: time,
						cls: "df-event-time",
					});
				}

				// Badge with Key + Icon
				const badge = rightDiv.createEl("div", { cls: "df-key-badge" });
				const icon = iconMap[key] || "";

				// Key name
				badge.createEl("span", { text: key });
				// Key Icon
				if (icon) {
					badge.createEl("span", { cls: "df-key-icon" }).innerHTML =
						icon;
				}
			}
		});
	}

	renderInputForm() {
		const form = this.container.createEl("form", { cls: "df-input-form" }); // NEW CLASS

		const timeInput = form.createEl("input", { type: "time" });
		timeInput.addClass("df-input-time"); // NEW CLASS

		const textInput = form.createEl("input", {
			type: "text",
			placeholder: "Событие...",
		});
		textInput.addClass("df-input-text"); // NEW CLASS

		const select = form.createEl("select", { cls: "df-input-select" }); // NEW CLASS
		this.plugin.settings.logKeys.forEach((k) => {
			const opt = select.createEl("option");
			opt.value = k.key;
			opt.text = k.iconSvg || k.key.replace("::", "");
			opt.title = k.key;
		});

		form.onsubmit = async (e) => {
			e.preventDefault();
			await this.addEntry(select.value, timeInput.value, textInput.value);
			textInput.value = "";
			timeInput.value = "";
		};
	}

	async addEntry(prefix: string, time: string, text: string) {
		const file = await this.getFileOrNull();
		if (!file) return;
		const recordedTime = moment().format("HH:mm");
		const entryTime = time ? time : "";
		const line = `${prefix} ${entryTime} ${text} (${recordedTime})`;
		const content = await this.app.vault.read(file);
		await this.app.vault.modify(file, content + `\n${line}`);
	}

	async createDailyNote() {
		const folder = this.getFolder();
		if (!this.app.vault.getAbstractFileByPath(folder))
			await this.app.vault.createFolder(folder);
		await this.app.vault.create(this.getFilePath(), "---\n---\n");
	}
}
