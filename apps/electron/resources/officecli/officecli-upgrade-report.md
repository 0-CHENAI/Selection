# OfficeCLI 升级差异报告

- 旧版本：1.0.157 (f950ee40)
- 新版本：1.0.159 (f950ee40)
- 上游 tag commit：5e625bf58aca732335590d7aa271f6337535a7ef
- 未分类命令：无
- 过期分类：无

## 命令

```json
{
  "added": [],
  "removed": [],
  "flagChanges": [
    {
      "command": "batch",
      "added": [
        "--compact"
      ],
      "removed": []
    },
    {
      "command": "help",
      "added": [
        "--compact"
      ],
      "removed": []
    }
  ]
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-mac-arm64",
        "sha256": "b78ac7f9213e5fd0de0e3cb5d0f81bd427f9dd74b6c31e134fd1167427559167"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-mac-x64",
        "sha256": "cc939ccac6fa468e0cd3cdbfdab39efdbf49d88ba9f0efad138fdddf494b1e22"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-linux-arm64",
        "sha256": "a27778548f2820771f54a70887af3c3ec214fe60e63b32836b09b3f3e2c4c493"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-linux-x64",
        "sha256": "92d9aeed324d91ed2a107f7f8dc7468829b14390a66cf2bbdfb25c40beac50ea"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-win-arm64.exe",
        "sha256": "2769867fb1bd19e1b33acdf9e69d0d94e6dc9ffa2425819e602a4c40ed83a997"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.159/officecli-win-x64.exe",
        "sha256": "572c0a4da35333cf866fa5a2fb8259a4a2a8c9922be031d6b7a86936282ef94e"
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
