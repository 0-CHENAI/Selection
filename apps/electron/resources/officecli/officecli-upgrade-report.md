# OfficeCLI 升级差异报告

- 旧版本：1.0.145 (b2b0b395)
- 新版本：1.0.146 (909df808)
- 上游 tag commit：0ae6c236c826a288f86ef9c5e321ee11afe00ee6
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
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-mac-arm64",
        "sha256": "d66763a563bc844c3cc67036ebc7c4a9caa9319b9592814d9acd3706da231fc1"
      },
      "after": {
        "name": "officecli-mac-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-mac-arm64",
        "sha256": "fdad1c51a95d18c4851f54327b7eec9f766b12a984e0930b48d877d5559e3161"
      }
    },
    {
      "key": "darwin-x64",
      "before": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-mac-x64",
        "sha256": "d7dc7013f7bf0af6345ae16a7913e6cf041947460d7f2fa3e024f0b27073d0a2"
      },
      "after": {
        "name": "officecli-mac-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-mac-x64",
        "sha256": "2b5547588a69270f649fbe623c4541755510f7501717f830e656a5408062198f"
      }
    },
    {
      "key": "linux-arm64",
      "before": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-linux-arm64",
        "sha256": "d38233bb7df4f0f5fb40313de1f00c0f0e575dc96b4164742709711ceec148c5"
      },
      "after": {
        "name": "officecli-linux-arm64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-linux-arm64",
        "sha256": "b3204a1a8a7949e44638267722f2abb6135be89f83f138fb6bea586c0e57af30"
      }
    },
    {
      "key": "linux-x64",
      "before": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-linux-x64",
        "sha256": "449f0e6a1298e3c6d7da792d26ab53d04ba77bd990f299b51123c7aef383d2ce"
      },
      "after": {
        "name": "officecli-linux-x64",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-linux-x64",
        "sha256": "bd343d96018a9ec4a72ff3599877a4fc4fed233258a62eddc06169711170d843"
      }
    },
    {
      "key": "win32-arm64",
      "before": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-arm64.exe",
        "sha256": "9ab800745ef06f4d30b8fd41729c516a4b28c86a24a32af8764d12a6a5226d57"
      },
      "after": {
        "name": "officecli-win-arm64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-win-arm64.exe",
        "sha256": "8a9d9edac22afd21c492a50f7866898863367cce103bc9b7e924e3528ff5e1fa"
      }
    },
    {
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-x64.exe",
        "sha256": "760696b262f3d6bd2cd174577220d54541b6e1e04ec58dee051f1897395638b8",
        "schemaCrc": "22d3fc61"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.146/officecli-win-x64.exe",
        "sha256": "ad36ca99a50102d8f953e8ed1742fab65c9e201a29733601ea6ca9e676b2eed0"
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

人工复验：1.0.146 的 `import` 已把 CSV/TSV（`--file` 与 `--stdin`）写入单元格，因此关闭 `importViaAtomicBatch`。

> 此报告只用于人工审查。运行时自更新保持禁用，draft PR 不会自动合并。
