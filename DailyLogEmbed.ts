import { App, TFile, moment } from "obsidian";
import DailyLogPlugin from "./main";

export class DailyLogEmbed {
	plugin: DailyLogPlugin;
	app: App;
	containerEl: HTMLElement;
	currentDate: string;

	constructor(el: HTMLElement, plugin: DailyLogPlugin, currentDate: string) {
		this.containerEl = el;
		this.plugin = plugin;
		this.app = plugin.app;
		this.currentDate = currentDate;
		this.containerEl.addClass("df-container"); // NEW CLASS
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
		this.containerEl.empty();

		// Navigation
		this.renderHeader();

		const file = await this.getFileOrNull();
		if (!file) {
			const msgDiv = this.containerEl.createEl("div", {
				cls: "df-msg-empty",
			});
			msgDiv.createEl("span", {
				text: `Заметка ${this.currentDate} не найдена.`,
			});
			return;
		}

		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);

		this.renderHabits(file, cache?.frontmatter);
		this.containerEl.createEl("hr");
		this.renderLogList(content);
		this.renderInputForm();
	}

	renderHeader() {
		const header = this.containerEl.createEl("div", { cls: "df-header" });

		const navGroup = header.createEl("div", { cls: "df-nav-group" });
		const prevBtn = navGroup.createEl("button", {
			text: "←",
			cls: "df-nav-btn",
		});
		prevBtn.onclick = () => {
			this.currentDate = moment(this.currentDate)
				.subtract(1, "day")
				.format("YYYY-MM-DD");
			this.render();
		};

		navGroup.createEl("span", {
			text: this.currentDate,
			cls: "df-date-title",
		});

		const nextBtn = navGroup.createEl("button", {
			text: "→",
			cls: "df-nav-btn",
		});
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
			});
			todayBtn.onclick = () => {
				this.currentDate = today;
				this.render();
			};
		}
	}

	renderHabits(file: TFile, frontmatter: any) {
		const habitsDiv = this.containerEl.createEl("div", {
			cls: "df-habits-list",
		});
		this.plugin.settings.habits.forEach((habit) => {
			const row = habitsDiv.createEl("div", { cls: "df-habit-row" });

			const left = row.createEl("div", { cls: "df-habit-label" });
			left.innerHTML = `<span class="df-habit-icon">${habit.iconSvg}</span> <span>${habit.key}</span>`;

			const val = frontmatter ? frontmatter[habit.key] : null;

			if (habit.type === "checkbox") {
				const cb = row.createEl("input", { type: "checkbox" });
				cb.addClass("df-habit-checkbox");
				cb.checked = val === true;
				cb.onchange = async () => {
					await this.updateFrontmatter(file, habit.key, cb.checked);
					this.render();
				};
			} else {
				const inp = row.createEl("input", {
					type: habit.type === "number" ? "number" : "text",
				});
				inp.addClass("df-habit-input");
				inp.value = val !== undefined ? val : "";
				inp.onblur = async () => {
					if (inp.value != val) {
						const saveVal =
							habit.type === "number"
								? Number(inp.value)
								: inp.value;
						await this.updateFrontmatter(file, habit.key, saveVal);
						this.render();
					}
				};
			}
		});
	}

	renderLogList(content: string) {
		const logContainer = this.containerEl.createEl("ul", {
			cls: "df-log-list",
		});
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

				const li = logContainer.createEl("li", {
					cls: "df-event-card",
				});

				li.createEl("div", { text: cleanText, cls: "df-event-text" });

				const rightDiv = li.createEl("div", { cls: "df-event-meta" });

				if (time)
					rightDiv.createEl("span", {
						text: time,
						cls: "df-event-time",
					});

				const badge = rightDiv.createEl("div", { cls: "df-key-badge" });
				const icon = iconMap[key] || "";
				badge.createEl("span", { text: key });
				if (icon)
					badge.createEl("span", { cls: "df-key-icon" }).innerHTML =
						icon;
			}
		});
	}

	renderInputForm() {
		const form = this.containerEl.createEl("form", {
			cls: "df-input-form",
		});

		const timeInput = form.createEl("input", { type: "time" });
		timeInput.addClass("df-input-time");

		const textInput = form.createEl("input", {
			type: "text",
			placeholder: "Событие...",
		});
		textInput.addClass("df-input-text");

		const select = form.createEl("select", { cls: "df-input-select" });
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
			await this.render();
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

	async updateFrontmatter(file: TFile, key: string, value: any) {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[key] = value;
		});
	}
}
