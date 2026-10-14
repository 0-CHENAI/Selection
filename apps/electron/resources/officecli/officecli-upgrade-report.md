# OfficeCLI 升级差异报告

- 旧版本：1.0.156 (616668a7)
- 新版本：1.0.157 (f950ee40)
- Windows x64 二进制复验：SHA256 与清单一致；命令与参数契约一致，schema CRC 为 c11d61e0，已记录平台专用值。
- 上游 tag commit：b65272a18aef891941451705ff93e8a287f3eb72
- 未分类命令：无
- 过期分类：无

## 命令

```json
{
  "added": [],
  "removed": [],
  "flagChanges": []
}
```

## Guides 与资源

```json
[]
```

## 平台资产

```json
{
  "added": [],
  "removed": [],
  "changed": [
    {
      "key": "darwin-arm64",
      "before": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-mac-arm64",
        "sha256": "8a6c1aa383ee8b9069d012914418a4814d183727ca100b6c3d1ef2839a460290"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-arm64",
        "sha256": "0dae0990a9cc29688a5d54469f984c34e5b15ab6bbd194a0ffdc571bb9040124"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-mac-x64",
        "sha256": "9487262651e76bf6f586a5edaa41c01b7318991aa10c382d0d46065259fac3bd"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-x64",
        "sha256": "178c1e9ebaf44c24d2b4b359064a5dea6eb7b2f539809871a3de1c09599dff9f"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-linux-arm64",
        "sha256": "972198c8db1f992ffd3fec4ecf6694533ecbdbae8da7a021ab513e73ecb2f15c"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-arm64",
        "sha256": "60db926c8a1371984b9e99622a834777befb02b6f73d0f3fff914ffcc2760d2f"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-linux-x64",
        "sha256": "a5ed6e4157fe9b24a099cd24ff30e89a4349b7a7d782d2b7de8d56294c7e1423"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-x64",
        "sha256": "f8eefe88dbfa7464bee421e5421efe57fc26bc3180b30e56eef58594c8245c94"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-win-arm64.exe",
        "sha256": "87645a5c6774c9d51153b04ae0c7715189a720cc29a0d9603b5bb8b33cdf44f2"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-arm64.exe",
        "sha256": "786e08b1ccf09c3a2107912537fe25fa82970b30145e3c59e09d83bf4032b065"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.156/officecli-win-x64.exe",
        "sha256": "70b4e26695cf3197694fb10033a1035395480cad409581eff8ca029f198ed37f",
        "schemaCrc": "c73899a4"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-x64.exe",
        "sha256": "bd64eba587e56cc71709cdd1f38ae9ac77cd65a9c8ea744b0996897c0557e343",
        "schemaCrc": "c11d61e0"
      }
    }
  ]
}
```

## 外部渲染依赖

```json
[]
```

## 需要复验的兼容 Recipe

```json
{}
```

> 此报告只用于人工审查。运行时自更新保持禁用，升级工作流不会自动合并 PR。
