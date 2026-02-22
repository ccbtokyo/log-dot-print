import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "fs/promises";
import { SqliteStorage } from "../sqlite-storage.js";

const TEST_DB_PATH = join(tmpdir(), "test-settings-storage.db");

describe("SqliteStorage Settings", () => {
  let storage: SqliteStorage;

  beforeEach(async () => {
    await cleanupTestDb();
    storage = new SqliteStorage(TEST_DB_PATH);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.shutdown();
    await cleanupTestDb();
  });

  async function cleanupTestDb() {
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
    try {
      await unlink(`${TEST_DB_PATH}-wal`);
    } catch {
      // Ignore
    }
    try {
      await unlink(`${TEST_DB_PATH}-shm`);
    } catch {
      // Ignore
    }
  }

  describe("getSetting / setSetting", () => {
    test("should return null for non-existent setting", async () => {
      const value = await storage.getSetting("non.existent.key");
      expect(value).toBeNull();
    });

    test("should save and retrieve a string setting", async () => {
      await storage.setSetting("printer.name", "EPSON VP-F4400 ESC/P");
      const value = await storage.getSetting("printer.name");
      expect(value).toBe("EPSON VP-F4400 ESC/P");
    });

    test("should overwrite existing setting", async () => {
      await storage.setSetting("printer.name", "Printer A");
      await storage.setSetting("printer.name", "Printer B");
      const value = await storage.getSetting("printer.name");
      expect(value).toBe("Printer B");
    });

    test("should handle multiple different settings", async () => {
      await storage.setSetting("printer.name", "My Printer");
      await storage.setSetting("app.theme", "dark");

      expect(await storage.getSetting("printer.name")).toBe("My Printer");
      expect(await storage.getSetting("app.theme")).toBe("dark");
    });

    test("should handle empty string value", async () => {
      await storage.setSetting("empty.key", "");
      const value = await storage.getSetting("empty.key");
      expect(value).toBe("");
    });

    test("should handle special characters in value", async () => {
      const specialValue = "プリンター名 with 'quotes' and \"double quotes\"";
      await storage.setSetting("special.key", specialValue);
      const value = await storage.getSetting("special.key");
      expect(value).toBe(specialValue);
    });
  });

  describe("deleteSetting", () => {
    test("should delete an existing setting", async () => {
      await storage.setSetting("to.delete", "value");
      await storage.deleteSetting("to.delete");
      const value = await storage.getSetting("to.delete");
      expect(value).toBeNull();
    });

    test("should not throw when deleting non-existent setting", async () => {
      // Should not throw
      await storage.deleteSetting("non.existent");
    });
  });

  describe("getAllSettings", () => {
    test("should return empty object when no settings exist", async () => {
      const settings = await storage.getAllSettings();
      expect(settings).toEqual({});
    });

    test("should return all settings as key-value pairs", async () => {
      await storage.setSetting("key1", "value1");
      await storage.setSetting("key2", "value2");
      await storage.setSetting("key3", "value3");

      const settings = await storage.getAllSettings();
      expect(settings).toEqual({
        key1: "value1",
        key2: "value2",
        key3: "value3",
      });
    });
  });
});
