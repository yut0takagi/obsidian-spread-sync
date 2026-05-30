import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import { SpreadSyncSettings } from "./types";

export interface SettingsTabDeps {
  getSettings(): SpreadSyncSettings;
  saveSettings(patch: Partial<SpreadSyncSettings>): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  clearCache(): void;
  cacheSize(): { entries: number; bytes: number };
}

export class SpreadSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: any, private deps: SettingsTabDeps) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.deps.getSettings();

    containerEl.createEl("h2", { text: "Spread Sync" });

    containerEl.createEl("h3", { text: "OAuth credentials" });
    containerEl.createEl("p", {
      text: "Bring your own Google Cloud OAuth client (Desktop type). See README for the 5-minute setup. Required before sign-in.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("OAuth client ID")
      .setDesc("From Google Cloud Console → APIs & Services → Credentials → OAuth client (Desktop).")
      .addText((t) =>
        t.setPlaceholder("000000000000-xxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com")
          .setValue(s.oauthClientId)
          .onChange(async (v) => { await this.deps.saveSettings({ oauthClientId: v.trim() }); }),
      );
    new Setting(containerEl)
      .setName("OAuth client secret")
      .setDesc("From the same credential JSON. Required by Google for Desktop OAuth (even with PKCE). Not actually confidential per Google's docs.")
      .addText((t) => {
        t.setPlaceholder("client secret from GCP credential JSON")
          .setValue(s.oauthClientSecret)
          .onChange(async (v) => { await this.deps.saveSettings({ oauthClientSecret: v.trim() }); });
        (t.inputEl as HTMLInputElement).type = "password";
      });

    containerEl.createEl("h3", { text: "Account" });
    const isSignedIn = !!s.encryptedRefreshToken;
    const hasCreds = s.oauthClientId.trim().length > 0;
    const desc = isSignedIn
      ? (s.accountEmail ? `Signed in as ${s.accountEmail}` : "Signed in (email unavailable — scopes do not include profile)")
      : (hasCreds ? "Not signed in" : "Enter OAuth credentials above first.");
    new Setting(containerEl)
      .setName("Google sign-in")
      .setDesc(desc)
      .addButton((b) => {
        if (isSignedIn) {
          b.setButtonText("Sign out").onClick(async () => {
            await this.deps.signOut();
            new Notice("Signed out");
            this.display();
          });
        } else {
          b.setButtonText("Sign in with Google").setCta().setDisabled(!hasCreds).onClick(async () => {
            try { await this.deps.signIn(); new Notice("Signed in"); }
            catch (e: any) { new Notice(`Sign-in failed: ${e?.message ?? e}`); }
            this.display();
          });
        }
      });

    containerEl.createEl("h3", { text: "Aliases" });
    const aliasContainer = containerEl.createDiv();
    const renderAliases = () => {
      aliasContainer.empty();
      for (const [name, id] of Object.entries(s.aliases)) {
        new Setting(aliasContainer)
          .setName(`@${name}`)
          .setDesc(id ?? "")
          .addButton((b) =>
            b.setButtonText("Remove").onClick(async () => {
              const next = { ...s.aliases };
              delete next[name];
              await this.deps.saveSettings({ aliases: next });
              this.display();
            }),
          );
      }
    };
    renderAliases();
    let newName = "", newId = "";
    new Setting(containerEl)
      .setName("Add alias")
      .addText((t) => t.setPlaceholder("alias-name").onChange((v) => (newName = v)))
      .addText((t) => t.setPlaceholder("spreadsheetId or URL").onChange((v) => (newId = v)))
      .addButton((b) =>
        b.setButtonText("Add").setCta().onClick(async () => {
          if (!newName || !newId) { new Notice("Both fields required"); return; }
          const next = { ...s.aliases, [newName]: newId };
          await this.deps.saveSettings({ aliases: next });
          this.display();
        }),
      );

    containerEl.createEl("h3", { text: "Cache" });
    const cs = this.deps.cacheSize();
    new Setting(containerEl)
      .setName("stale TTL (minutes)")
      .addText((t) =>
        t.setValue(String(s.staleTTLMinutes)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 1) return;
          await this.deps.saveSettings({ staleTTLMinutes: n });
        }),
      );
    new Setting(containerEl)
      .setName("Current size")
      .setDesc(`${cs.entries} entries / ${Math.round(cs.bytes / 1024)} KB`)
      .addButton((b) =>
        b.setButtonText("Clear cache").setWarning().onClick(() => {
          this.deps.clearCache();
          new Notice("Cache cleared");
          this.display();
        }),
      );

    containerEl.createEl("h3", { text: "Behavior" });
    new Setting(containerEl).setName("Fetch on file open")
      .addToggle((t) => t.setValue(s.fetchOnOpen).onChange((v) => this.deps.saveSettings({ fetchOnOpen: v })));
    new Setting(containerEl).setName("stale-while-revalidate")
      .addToggle((t) => t.setValue(s.staleWhileRevalidate).onChange((v) => this.deps.saveSettings({ staleWhileRevalidate: v })));
    new Setting(containerEl).setName("Refetch when coming back online")
      .addToggle((t) => t.setValue(s.refetchOnOnline).onChange((v) => this.deps.saveSettings({ refetchOnOnline: v })));

    containerEl.createEl("h3", { text: "Advanced" });
    new Setting(containerEl).setName("Debug logs")
      .addToggle((t) => t.setValue(s.debugLog).onChange((v) => this.deps.saveSettings({ debugLog: v })));
    new Setting(containerEl).setName("API endpoint override (testing)")
      .addText((t) =>
        t.setValue(s.apiEndpointOverride ?? "").onChange((v) =>
          this.deps.saveSettings({ apiEndpointOverride: v.trim() === "" ? null : v.trim() }),
        ),
      );
  }
}
