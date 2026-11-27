# OfficeCLI 升级差异报告

- 旧版本：1.0.162 (f950ee40)
- 新版本：1.0.163 (f950ee40)
- 上游 tag commit：fecece3ee6054f419d2e8ecca899d7498142d417
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
    "name": "financial-model",
    "headings": {
      "added": [
        "3:Base QA — the officecli-xlsx minimum cycle, verbatim"
      ],
      "removed": [
        "3:Gates 1–3 — inherited from xlsx v2 verbatim"
      ]
    },
    "assets": {
      "added": [],
      "removed": [],
      "changed": [
        {
          "path": "SKILL.md",
          "beforeSha256": "65280bce9537ff3192bbc8fe1ad94980662929a71390b258d7f38f24772d8c9e",
          "afterSha256": "83a098681b43a1541ae2e33c799aee99dc0a4d120ca9f5ce4f7c192934c42b0b"
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-mac-arm64",
        "sha256": "7c54c00bfea9d28a69282661f0e3a08d455c8fca1a1d486f4c146c867b693797"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-mac-arm64",
        "sha256": "12bbe7c322a4114533bcc115e8ff6255917a35de0432c85111be534c82a9cbe1"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-mac-x64",
        "sha256": "770a2b0fcb2dd9e964a10c71a52a159a022138185fdedf990ab587fc5263af9e"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-mac-x64",
        "sha256": "d9737acd91771bcdbc33850423a7edc4a805cc8dd4053a910cd88401baba630c"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-linux-arm64",
        "sha256": "59763bc3e9f03784fb4ddb7a2571deabaaf5fb999f42aaee6407191424c38816"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-linux-arm64",
        "sha256": "94dd4e1e5db095d2eec691a74c6fd508bf4b651432aade07d41a217cf997ff83"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-linux-x64",
        "sha256": "df40e8f21b5c84826565f7c9c96f7e1a70ffbfe141b507bdad70533eaeacc190"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-linux-x64",
        "sha256": "ba4d75d293aefee222659793074d569a3f94a34a28e2894bfe6d018015cffa95"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-win-arm64.exe",
        "sha256": "9d474ee49b3c1fc0b43825e4a6f284a79a80703a8fcfad199c7027322d6858fb"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-win-arm64.exe",
        "sha256": "0ef9eff51e2df2ee7cdbfa35e3b5660914412bd288960ce0323c43720856f7f9"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.162/officecli-win-x64.exe",
        "sha256": "4ef5480e99cf60809b1db8817b2892f0a41062bbb9a9b34f700befe67ed3135c",
        "schemaCrc": "c11d61e0"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.163/officecli-win-x64.exe",
        "sha256": "8c351bff88728b538f2754bbfd3a09ea2cf6199c78a9e4feeca717d0135a9f56"
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
