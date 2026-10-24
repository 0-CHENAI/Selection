# OfficeCLI 升级差异报告

- 旧版本：1.0.157 (f950ee40)
- 新版本：1.0.158 (f950ee40)
- 上游 tag commit：2900a4a20f49d6a94384d6ea7fb8cc0120999825
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
[
  {
    "name": "word",
    "headings": {
      "added": [],
      "removed": []
    },
    "assets": {
      "added": [],
      "removed": [],
      "changed": [
        {
          "path": "SKILL.md",
          "beforeSha256": "4dbeacba4bd107417fc31204ce22e91b37e5747d0541090d75ebb0ed14e02559",
          "afterSha256": "a5a294fc04ec9983d766cec70887d563f3337e13a8a25db37d5a522bd37fc298"
        }
      ]
    }
  }
]
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-arm64",
        "sha256": "0dae0990a9cc29688a5d54469f984c34e5b15ab6bbd194a0ffdc571bb9040124"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-mac-arm64",
        "sha256": "67cf08d95fab556cad9d1e9d0d3b76a7962b5658c716aeaef2e83cbc19af7ff7"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-mac-x64",
        "sha256": "178c1e9ebaf44c24d2b4b359064a5dea6eb7b2f539809871a3de1c09599dff9f"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-mac-x64",
        "sha256": "038716417adb626d5e94bc71dfecea2d2be9838f3d9b2eb49c2f0b3d634cf4f2"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-arm64",
        "sha256": "60db926c8a1371984b9e99622a834777befb02b6f73d0f3fff914ffcc2760d2f"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-linux-arm64",
        "sha256": "b1d5e74d93a8471a47b037cc7774ac29c559940e226f99b9fdf788966cc395b8"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-linux-x64",
        "sha256": "f8eefe88dbfa7464bee421e5421efe57fc26bc3180b30e56eef58594c8245c94"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-linux-x64",
        "sha256": "9ee41d5558caea7bcd5aab1b3e76b2bd70f0535f09cf65dda3668130510cc719"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-arm64.exe",
        "sha256": "786e08b1ccf09c3a2107912537fe25fa82970b30145e3c59e09d83bf4032b065"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-win-arm64.exe",
        "sha256": "48567b4bc5a124fb0a709bac29a1e13b6760f094741d0e2bb755680ec9e51295"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.157/officecli-win-x64.exe",
        "sha256": "bd64eba587e56cc71709cdd1f38ae9ac77cd65a9c8ea744b0996897c0557e343",
        "schemaCrc": "c11d61e0"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.158/officecli-win-x64.exe",
        "sha256": "117545f3bc817d7c6d2e78a62e4f73f75b918ccd61558e404c60949a8cb9fd1f"
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
