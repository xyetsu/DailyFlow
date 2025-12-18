import { Plugin, WorkspaceLeaf, moment, TFile } from "obsidian";
import { DailyLogView, VIEW_TYPE_DAILY_LOG } from "./DailyLogView";
import { DailyLogEmbed } from "./DailyLogEmbed";
import {
	DailyLogSettingTab,
	DailyLogSettings,
	DEFAULT_SETTINGS,
} from "./DailyLogSettings";

export default class DailyLogPlugin extends Plugin {
	settings: DailyLogSettings;

	async onload() {
		await this.loadSettings();
		this.updateCssVariables();

		// 1. Регистрируем боковую панель (View)
		this.registerView(
			VIEW_TYPE_DAILY_LOG,
			(leaf) => new DailyLogView(leaf, this)
		);

		// 2. Регистрируем Markdown блок (Embed)
		this.registerMarkdownCodeBlockProcessor(
			"daily-flow-embed",
			async (source, el, ctx) => {
				let targetDate = moment().format("YYYY-MM-DD");

				const sourceText = source.trim();
				if (sourceText) {
					const parsedDate = moment(
						sourceText,
						["YYYY-MM-DD", "YYYYMMDD"],
						true
					);
					if (parsedDate.isValid()) {
						targetDate = parsedDate.format("YYYY-MM-DD");
					} else {
						el.createEl("div", {
							text: `Ошибка даты: "${sourceText}".`,
							cls: "error-msg",
						});
						return;
					}
				}

				const embedView = new DailyLogEmbed(el, this, targetDate);
				await embedView.render();
			}
		);

		// 3. Риббон и команды
		this.addRibbonIcon("calendar-days", "Daily Flow", () =>
			this.activateView()
		);
		this.addCommand({
			id: "open-daily-flow",
			name: "Открыть панель дня",
			callback: () => this.activateView(),
		});

		// 4. Настройки
		this.addSettingTab(new DailyLogSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_DAILY_LOG);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({
					type: VIEW_TYPE_DAILY_LOG,
					active: true,
				});
			}
		}
		if (leaf) workspace.revealLeaf(leaf);
	}
	updateCssVariables() {
		// Устанавливаем переменную на элемент body, чтобы она была доступна везде
		document.body.style.setProperty(
			"--df-hover-edit-size",
			`${this.settings.hoverEditButtonSize}px`
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.updateCssVariables();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Обновляем открытые View
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_DAILY_LOG)
			.forEach((leaf) => {
				if (leaf.view instanceof DailyLogView) leaf.view.render();
			});
		this.updateCssVariables();
	}
}
