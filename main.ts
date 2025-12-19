import { Plugin, TFile, moment } from "obsidian";
import {
	DailyLogSettings,
	DEFAULT_SETTINGS,
	DailyLogSettingTab,
} from "./DailyLogSettings";
import { DailyLogEmbed } from "./DailyLogEmbed";

export default class DailyLogPlugin extends Plugin {
	settings: DailyLogSettings;
	styleTag: HTMLStyleElement;

	async onload() {
		// 1. Загружаем настройки
		await this.loadSettings();

		// 2. Создаем тег для CSS переменных (для мобилок)
		this.styleTag = document.createElement("style");
		this.styleTag.id = "df-dynamic-styles";
		document.head.appendChild(this.styleTag);

		// 3. Применяем стили сразу
		this.updateCssVariables();

		// 4. Добавляем вкладку настроек
		this.addSettingTab(new DailyLogSettingTab(this.app, this));

		// 5. Регистрируем блок кода
		// Мы регистрируем обработчик, который сработает, когда Obsidian увидит ```daily-flow-embed
		this.registerMarkdownCodeBlockProcessor(
			"daily-flow-embed",
			(source, el, ctx) => {
				this.handleCodeBlock(el, ctx);
			}
		);

		// Добавляем алиас (короткое имя), чтобы работало и так, и так
		this.registerMarkdownCodeBlockProcessor(
			"dailylog",
			(source, el, ctx) => {
				this.handleCodeBlock(el, ctx);
			}
		);
	}

	// Вынес логику в отдельную функцию, чтобы не дублировать
	handleCodeBlock(el: HTMLElement, ctx: any) {
		// Определяем дату файла
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		let dateStr = moment().format("YYYY-MM-DD");

		if (file instanceof TFile) {
			// Пытаемся взять дату из имени файла (формат YYYY-MM-DD)
			const nameDate = moment(file.basename, "YYYY-MM-DD", true);
			if (nameDate.isValid()) {
				dateStr = nameDate.format("YYYY-MM-DD");
			}
		}

		// Создаем экземпляр нашего интерфейса
		const embed = new DailyLogEmbed(el, this, dateStr);

		// Рендерим СРАЗУ, чтобы не было пустого поля
		embed.render();

		// (Опционально) Если DailyLogEmbed имеет методы очистки, их можно привязать к onunload
		// Но так как это простой класс, этого достаточно.
	}

	onunload() {
		if (this.styleTag) {
			this.styleTag.remove();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateCssVariables();
	}

	updateCssVariables() {
		const s = this.settings;
		const css = `
			body {
				--df-hover-edit-size: ${s.hoverEditButtonSize}px;
				--df-time-inline-color: ${s.timeInlineColor};
				--df-time-inline-weight: ${s.timeInlineWeight};
				--df-habits-gap: ${s.habitsGap}px;
				--df-habit-label-size: ${s.habitLabelFontSize}px;
			}
		`;
		this.styleTag.innerHTML = css;
	}
}
