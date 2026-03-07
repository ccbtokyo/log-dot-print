# Session 0 非対称 DPI 問題と解決策

## 概要

Windows サービス（Session 0）で EPSON VP-F4400N ドットインパクトプリンターを使用すると、印刷結果が **左半分に水平圧縮（50%）** される問題が発生する。インタラクティブセッション（Session 1+）では正常に印刷される。

## 根本原因

### DEVMODE の DPI 不一致

| セッション                     | DPI     | 結果         |
| ------------------------------ | ------- | ------------ |
| インタラクティブ（Session 1+） | 180×180 | 正常         |
| サービス（Session 0）          | 360×180 | 50% 水平圧縮 |

- EPSON VP-F4400N のネイティブ解像度は **360×180**（24ピンドットインパクトの特性）
- インタラクティブセッションでは、過去に「印刷設定」UI で 180×180 に変更されており、per-user DEVMODE（HKCU）に保存されている
- Session 0 はグローバルデフォルト DEVMODE を使用するため、ドライバーデフォルトの 360×180 になる

### SumatraPDF と非対称 DPI

SumatraPDF はプリンターのデフォルト DEVMODE を使用して GDI 印刷を行う。非対称 DPI（360×180）のとき、水平方向と垂直方向のスケーリングが正しく処理されず、50% の水平圧縮が発生する。

## 試行した解決策と結果

### 1. Set-PrintConfiguration（PrintTicket API）— 失敗

```powershell
# 構造化 XML フィールドの変更
$xNode.InnerText = "180"; $yNode.InnerText = "180"
Set-PrintConfiguration -PrinterName $name -PrintTicketXml $ticket.OuterXml
```

**失敗理由**: `Set-PrintConfiguration` は内部で PrintTicket Provider を経由する。EPSON ESC/P ドライバーの Provider は、Option 名（`RESO_FIRST` = 360×180）から DEVMODE を**再生成**するため、変更した値が書き戻される。

```
PrintTicket XML → ConvertPrintTicketToDevMode() → DEVMODE 正規化 → 360×180 に戻る
                        ↑ ドライバーの PrintTicket Provider
```

PrintTicket XML 内の `PageDevmodeSnapshot`（DEVMODE バイナリの Base64）を直接修正しても同様に書き戻される。

### 2. Win32 SetPrinter API（C# P/Invoke via Add-Type）— Session 0 でハング

```powershell
Add-Type -TypeDefinition @"
public class DevModeFixer {
    [DllImport("winspool.drv")] ...
}
"@ -Language CSharp
```

**失敗理由**: `Add-Type` は内部で C# コンパイラ（csc.exe）を呼び出す。Session 0 では TEMP ディレクトリへのアクセス制限により、コンパイルがハングする（タイムアウトもエラーも出ない）。

さらに、PowerShell の `-Command` パラメータに C# here-string（`@"..."@`）を渡す場合も、パース段階でサイレントに失敗する。

### 3. レジストリ直接パッチ — 成功

```powershell
$regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Print\Printers\$PrinterName"
$devmode = (Get-ItemProperty -Path $regPath -Name "Default DevMode")."Default DevMode"
# offset 90: dmPrintQuality (Int16) = X DPI
# offset 96: dmYResolution  (Int16) = Y DPI
[BitConverter]::GetBytes([Int16]180).CopyTo($devmode, 90)
[BitConverter]::GetBytes([Int16]180).CopyTo($devmode, 96)
Set-ItemProperty -Path $regPath -Name "Default DevMode" -Value ([byte[]]$devmode)
Restart-Service Spooler
```

**成功理由**: PrintTicket Provider を完全にバイパスし、スプーラーが読み取るレジストリの DEVMODE バイナリを直接書き換える。Spooler 再起動後、新しい値が全セッションで有効になる。

## 実装

### scripts/fix-dpi.ps1

起動時に `NativePrinter.ensureSymmetricDpi()` から呼ばれる。

1. `HKLM\SYSTEM\CurrentControlSet\Control\Print\Printers\<name>\Default DevMode` を読み取り
2. offset 90（dmPrintQuality）と offset 96（dmYResolution）を比較
3. 非対称の場合、小さい方の値（180）に統一
4. レジストリに書き戻し、Spooler を再起動
5. 再読み取りして検証

### 前提条件

- サービスアカウントに **HKLM への書き込み権限** が必要（WinSW で `.\USERNAME` として実行している場合、管理者権限がないと失敗する可能性がある。`install-service.ps1` で事前に実行するのが確実）
- Spooler 再起動により、進行中の印刷ジョブが中断される可能性がある

## DEVMODE 構造体の関連フィールド

```c
// wingdi.h (抜粋)
typedef struct _DEVMODEW {
    WCHAR  dmDeviceName[32];     // offset 0
    // ...
    short  dmPrintQuality;       // offset 90 (0x5A) — X DPI (正値) or 品質プリセット (負値)
    // ...
    short  dmYResolution;        // offset 96 (0x60) — Y DPI
    // ...
} DEVMODEW;
```

## レジストリパス

| 種類                 | パス                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| グローバルデフォルト | `HKLM\SYSTEM\CurrentControlSet\Control\Print\Printers\<name>\Default DevMode` |
| Per-user デフォルト  | `HKCU\Printers\DevModePerUser\<name>`                                         |

Session 0 は Per-user デフォルトが存在しない（またはマシンアカウントのプロファイル）ため、グローバルデフォルトにフォールバックする。

## 対象マシン

| マシン | paperKind | 修正前の状態                   |
| ------ | --------- | ------------------------------ |
| no1    | 120       | 180×180（修正不要）            |
| no2    | 146       | 360×180 → 180×180 に修正       |
| no3    | 176       | 360×180 → 180×180 に修正が必要 |
