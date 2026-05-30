import { Plugin, Notice, MarkdownView, Component } from "obsidian";
import { SpreadSyncSettings } from "./src/settings/types";
import { DEFAULT_SETTINGS, SHEETS_ENDPOINT } from "./src/settings/defaults";
import { SpreadSyncSettingTab } from "./src/settings/SettingsTab";
import { OAuthClient } from "./src/auth/OAuthClient";
import { TokenStore } from "./src/auth/TokenStore";
import { AuthService } from "./src/auth/AuthService";
import { SheetsClient } from "./src/sheets/SheetsClient";
import { DriveClient } from "./src/sheets/DriveClient";
import { CacheStore, CacheEntry } from "./src/storage/CacheStore";
import { makeInlineProcessor } from "./src/renderer/inlineProcessor";
import { registerSyncBlockProcessor } from "./src/renderer/blockProcessor";
import { refreshCurrentFile } from "./src/commands/refreshCurrent";
import { refreshAllOpenFiles } from "./src/commands/refreshAll";
import { refreshBySpreadsheet } from "./src/commands/refreshBySpreadsheet";
import { pushCurrentBlock } from "./src/commands/pushBlock";

interface PersistedData {
  settings: SpreadSyncSettings;
  cache: Record<string, CacheEntry>;
}

export default class SpreadSyncPlugin extends Plugin {
  settings!: SpreadSyncSettings;
  cache!: CacheStore;
  sheets!: SheetsClient;
  drive!: DriveClient;
  auth!: AuthService;

  async onload() {
    const data: PersistedData = Object.assign(
      { settings: { ...DEFAULT_SETTINGS }, cache: {} },
      (await this.loadData()) ?? {},
    );
    this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    this.cache = new CacheStore({
      persist: (snapshot) => {
        this.saveData({ settings: this.settings, cache: snapshot }).catch(console.error);
      },
    });
    this.cache.load(data.cache);

    const oauth = new OAuthClient({
      clientId: this.settings.oauthClientId,
      clientSecret: this.settings.oauthClientSecret,
    });
    const tokenStore = new TokenStore(safeStorageOrThrow());
    this.auth = new AuthService(
      oauth,
      tokenStore,
      {
        save: async (partial) => {
          this.settings.encryptedRefreshToken = partial.encryptedRefreshToken;
          this.settings.tokenExpiresAt = partial.tokenExpiresAt;
          this.settings.accountEmail = partial.accountEmail;
          await this.persist();
        },
        load: () => ({
          encryptedRefreshToken: this.settings.encryptedRefreshToken,
          tokenExpiresAt: this.settings.tokenExpiresAt,
          accountEmail: this.settings.accountEmail,
        }),
      },
      (url: string) => {
        // Open in OS default browser (not an Electron window).
        try {
          const shell = (window as any).require?.("electron")?.shell;
          if (shell?.openExternal) { shell.openExternal(url); return; }
        } catch {}
        // Fallback to Obsidian's helper or window.open.
        const anyApp = this.app as any;
        if (typeof anyApp?.openUrl === "function") { anyApp.openUrl(url); return; }
        window.open(url, "_blank");
      },
    );

    this.sheets = new SheetsClient(this.auth, {
      endpoint: this.settings.apiEndpointOverride ?? SHEETS_ENDPOINT(null),
    });
    this.drive = new DriveClient(this.auth);

    const rerender = () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      view?.previewMode?.rerender?.(true);
    };

    const onAuthError = () => {
      new Notice("Spread Sync: open settings to sign in");
      (this.app as any).setting?.open?.();
      (this.app as any).setting?.openTabById?.("spread-sync");
    };

    this.registerMarkdownPostProcessor(
      makeInlineProcessor({
        sheets: this.sheets,
        cache: this.cache,
        aliases: () => this.settings.aliases,
        staleTtlMs: () => this.settings.staleTTLMinutes * 60_000,
        staleWhileRevalidate: () => this.settings.staleWhileRevalidate,
        onAuthError,
        isOffline: () => !navigator.onLine,
      }),
    );

    const hostComponent = new Component();
    this.addChild(hostComponent);
    registerSyncBlockProcessor(this, {
      sheets: this.sheets,
      drive: this.drive,
      cache: this.cache,
      aliases: () => this.settings.aliases,
      staleTtlMs: () => this.settings.staleTTLMinutes * 60_000,
      staleWhileRevalidate: () => this.settings.staleWhileRevalidate,
      onAuthError,
      isOffline: () => !navigator.onLine,
      hostComponent,
    });

    this.addCommand({
      id: "refresh-current-file",
      name: "Refresh current file",
      callback: () => refreshCurrentFile({
        app: this.app, cache: this.cache, aliases: () => this.settings.aliases, rerender,
      }),
    });
    this.addCommand({
      id: "refresh-all-open-files",
      name: "Refresh all open files",
      callback: () => refreshAllOpenFiles({
        app: this.app, cache: this.cache, aliases: () => this.settings.aliases, rerender,
      }),
    });
    this.addCommand({
      id: "refresh-by-spreadsheet",
      name: "Refresh by spreadsheet",
      callback: () => refreshBySpreadsheet({
        app: this.app, cache: this.cache, aliases: () => this.settings.aliases, rerender,
      }),
    });
    this.addCommand({
      id: "push-this-block",
      name: "Push this block",
      callback: () => pushCurrentBlock({
        app: this.app, sheets: this.sheets, drive: this.drive, cache: this.cache,
        aliases: () => this.settings.aliases,
      }),
    });

    this.addSettingTab(new SpreadSyncSettingTab(this.app, this, {
      getSettings: () => this.settings,
      saveSettings: async (patch) => { Object.assign(this.settings, patch); await this.persist(); },
      signIn: () => this.auth.signIn(),
      signOut: () => this.auth.signOut(),
      clearCache: () => this.cache.clear(),
      cacheSize: () => {
        const snap = this.cache.snapshot();
        return { entries: Object.keys(snap).length, bytes: JSON.stringify(snap).length };
      },
    }));

    if (this.settings.fetchOnOpen) {
      this.registerEvent(this.app.workspace.on("file-open", () => rerender()));
    }
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, cache: this.cache.snapshot() });
  }

  onunload() {}
}

function safeStorageOrThrow() {
  // Electron's safeStorage. Try @electron/remote first, then electron module via require.
  const tryRequire = (name: string): any => {
    try { return (window as any).require?.(name); } catch { return null; }
  };
  const safeStorage = tryRequire("@electron/remote")?.safeStorage
    ?? tryRequire("electron")?.remote?.safeStorage
    ?? tryRequire("electron")?.safeStorage;
  if (!safeStorage) throw new Error("Electron safeStorage is unavailable. Desktop-only plugin.");
  return safeStorage;
}
