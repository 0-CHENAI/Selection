# OfficeCLI 升级差异报告

- 旧版本：1.0.145 (b2b0b395)
- 新版本：1.0.145 (b2b0b395)
- 上游 tag commit：e402d2853259177aba05ee6f79d38b7e1ff067ae
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
      "key": "win32-x64",
      "before": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-x64.exe",
        "sha256": "760696b262f3d6bd2cd174577220d54541b6e1e04ec58dee051f1897395638b8",
        "schemaCrc": "22d3fc61"
      },
      "after": {
        "name": "officecli-win-x64.exe",
        "url": "https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.145/officecli-win-x64.exe",
        "sha256": "760696b262f3d6bd2cd174577220d54541b6e1e04ec58dee051f1897395638b8"
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
{
  "importViaAtomicBatch": {
    "enabled": true,
    "maxSourceBytes": 5000000,
    "reason": "The reviewed OfficeCLI release reports successful CSV/TSV import without persisting worksheet cells; use one atomic native batch until a reviewed upgrade passes the real content assertion."
  }
}
```

> 此报告只用于人工审查。运行时自更新保持禁用，draft PR 不会自动合并。
