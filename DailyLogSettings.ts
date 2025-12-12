import { App, PluginSettingTab, Setting } from "obsidian";
import DailyLogPlugin from "./main";

export interface HabitConfig {
	key: string;
	type: "checkbox" | "number" | "text";
	iconSvg: string;
}

export interface LogKeyConfig {
	key: string;
	iconSvg: string;
	tags: string;
}

export interface DailyLogSettings {
	habits: HabitConfig[];
	logKeys: LogKeyConfig[];
}

export const DEFAULT_SETTINGS: DailyLogSettings = {
	habits: [
		{
			key: "Сон",
			type: "number",
			iconSvg:
				'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>',
		},
		{
			key: "Зарядка",
			type: "checkbox",
			iconSvg:
				'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
		},
	],
	logKeys: [
		{ key: "dl::", iconSvg: "📄", tags: "" },
		{ key: "Важно::", iconSvg: "🔥", tags: "важно" },
		{ key: "Идея::", iconSvg: "💡", tags: "идея" },
	],
};

export class DailyLogSettingTab extends PluginSettingTab {
	plugin: DailyLogPlugin;

	constructor(app: App, plugin: DailyLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Настройки Daily Flow" });

		new Setting(containerEl)
			.setName("Привычки (JSON)")
			.setDesc("Массив объектов: {key, type, iconSvg}")
			.addTextArea((text) =>
				text
					.setValue(
						JSON.stringify(this.plugin.settings.habits, null, 2)
					)
					.setPlaceholder("[]")
					.onChange(async (value) => {
						try {
							this.plugin.settings.habits = JSON.parse(value);
							await this.plugin.saveSettings();
						} catch (e) {
							console.error("Invalid JSON");
						}
					})
			);

		new Setting(containerEl)
			.setName("Ключи лога (JSON)")
			.setDesc("Массив объектов: {key, iconSvg, tags}")
			.addTextArea((text) =>
				text
					.setValue(
						JSON.stringify(this.plugin.settings.logKeys, null, 2)
					)
					.setPlaceholder("[]")
					.onChange(async (value) => {
						try {
							this.plugin.settings.logKeys = JSON.parse(value);
							await this.plugin.saveSettings();
						} catch (e) {
							console.error("Invalid JSON");
						}
					})
			);
	}
}
