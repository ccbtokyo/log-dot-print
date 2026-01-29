# Dead Code Analysis Report

**Generated:** 2026-01-29
**Tools Used:** knip, depcheck

---

## Summary

| Category | Count |
|----------|-------|
| Unused Files | 14 (mostly UI - separate build) |
| Unused Dependencies | 1 |
| Unused Dev Dependencies | 2 |
| Unused Exports | 14 |
| Unused Types | 4 |
| Missing Dependencies | 1 |

---

## 1. Unused Dependencies (package.json)

### Dependencies
| Package | Severity | Notes |
|---------|----------|-------|
| `lit-html` | SAFE | Used by UI (separate esbuild) - knip false positive |

### Dev Dependencies
| Package | Severity | Notes |
|---------|----------|-------|
| `@types/serialport` | **SAFE to remove** | Only used in serial.ts which uses the serialport package directly |
| `tsx` | **SAFE to remove** | Not used - bun handles TypeScript natively |

---

## 2. Unused Files (knip detection)

All UI files are flagged because they are built separately via `bun build` (not through the main entry):

| File | Severity | Notes |
|------|----------|-------|
| `src/server/index.ts` | **SAFE to remove** | Barrel export, not imported anywhere |
| `src/ui/main.ts` | SAFE (false positive) | Entry point for UI build |
| `src/ui/types.ts` | SAFE (false positive) | Used by UI components |
| `src/ui/components/*.ts` | SAFE (false positive) | Used by UI |
| `src/ui/services/*.ts` | SAFE (false positive) | Used by UI |
| `src/ui/state/store.ts` | SAFE (false positive) | Used by UI |

---

## 3. Unused Exports

### SAFE - Can be removed
| File | Export | Reason |
|------|--------|--------|
| `src/core/utils.ts` | `validateLogEntry` | Not used anywhere, replaced by `parseLogEntry` |
| `src/core/events.ts` | `eventBus` | Singleton pattern, but never directly imported (instances created inline) |
| `src/server/app.ts` | `defaultConfig` | Internal constant, not needed externally |
| `src/printers/registry.ts` | `PrinterRegistry` (class) | Only `printerRegistry` singleton is used |
| `src/printers/formatter.ts` | `MinimalFormatter` | Never instantiated |
| `src/printers/formatter.ts` | `JsonFormatter` | Never instantiated |

### CAUTION - Review before removal
| File | Export | Reason |
|------|--------|--------|
| `src/printers/escpos.ts` | `EscPosPrinter`, `createEscPosPrinter`, `register` | Side-effect import registers - keep for now |
| `src/printers/cups.ts` | `CupsPrinter`, `createCupsPrinter`, `register` | Side-effect import registers - keep for now |
| `src/printers/mock.ts` | `MockPrinter`, `createMockPrinter`, `register` | Side-effect import registers - keep for now |
| `src/printers/serial.ts` | `SerialPrinter`, `createSerialPrinter`, `register` | Side-effect import registers - keep for now |

---

## 4. Unused Types

| File | Type | Severity | Notes |
|------|------|----------|-------|
| `src/core/interfaces.ts` | `Plugin` | CAUTION | Base interface, may be used for documentation |
| `src/core/interfaces.ts` | `PluginRegistry` | CAUTION | Interface, may be used for documentation |
| `src/server/ui/index.ts` | `ClientMessage`, `ServerMessage`, `StaticMiddlewareConfig` | CAUTION | May be used by UI or for API documentation |

---

## 5. Missing Dependencies

| Package | Used In | Notes |
|---------|---------|-------|
| `escpos-serialport` | `src/printers/escpos.ts` | Dynamic import, OK if serial not used |

---

## 6. Recommended Actions

### Safe to Delete (Priority 1)
1. **Remove `@types/serialport`** from devDependencies - redundant
2. **Remove `tsx`** from devDependencies - bun handles TypeScript
3. **Remove `src/server/index.ts`** - unused barrel export
4. **Remove `validateLogEntry`** from `src/core/utils.ts` - dead code
5. **Remove `MinimalFormatter`** from `src/printers/formatter.ts` - never used
6. **Remove `JsonFormatter`** from `src/printers/formatter.ts` - never used

### Requires More Analysis (Priority 2)
1. **`eventBus` export** - verify if singleton pattern is intentional
2. **`defaultConfig` export** - may be useful for library consumers
3. **`PrinterRegistry` class export** - may be useful for testing

### Do NOT Remove
1. All `src/ui/**` files - built separately, not dead code
2. Printer implementations (`escpos.ts`, `cups.ts`, etc.) - side-effect imports
3. `Plugin` and `PluginRegistry` interfaces - architectural documentation

---

## Test Results Before Changes

```
104 pass
0 fail
220 expect() calls
Ran 104 tests across 8 files. [1259.00ms]
```

---

## 7. Cleanup Actions Taken

### Removed Items

| Item | Type | File |
|------|------|------|
| `@types/serialport` | devDependency | package.json |
| `tsx` | devDependency | package.json |
| `src/server/index.ts` | Unused file | (deleted) |
| `validateLogEntry` | Unused function | src/core/utils.ts |
| `MinimalFormatter` | Unused class | src/printers/formatter.ts |
| `JsonFormatter` | Unused class | src/printers/formatter.ts |

### Verification Results

```
bun test:  104 pass, 0 fail
bun build: Success (56.58 KB)
bun lint:  0 warnings, 0 errors
bun format: Success
```

### Not Removed (Intentional)

- **Printer implementations** (`escpos.ts`, `cups.ts`, etc.) - Side-effect imports for registry
- **UI files** - Separate build target via esbuild
- **Interface types** (`Plugin`, `PluginRegistry`) - Architectural documentation
- **`eventBus` export** - May be useful for consumers
- **`defaultConfig` export** - May be useful for consumers
